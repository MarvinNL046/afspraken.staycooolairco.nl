import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { parseISO, isValid, format, startOfDay, endOfDay, addDays, isWeekend, addMinutes } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import { findAvailableSlots } from '../../lib/route-optimization';
import { validateServiceArea } from '../../lib/boundary-validator';

const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

// Validation schemas
const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  customerLocation: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().min(1).max(500),
    postalCode: z.string().regex(/^\d{4}\s?[A-Z]{2}$/i, 'Invalid Dutch postal code'),
    city: z.string().min(1).max(100),
  }).optional(),
  serviceType: z.enum(['installation', 'maintenance', 'repair', 'inspection']).optional(),
  duration: z.number().min(30).max(480).optional(), // 30 minutes to 8 hours
  maxResults: z.number().min(1).max(50).optional(),
});

const SALES_TEAM_COLOR_ID = '5'; // Yellow color in Google Calendar
const BUSINESS_HOURS = {
  start: '09:30',
  end: '16:00',
  workDays: [1, 2, 3, 4, 5], // Monday to Friday
  maxAppointmentsPerDay: 5,
  defaultDuration: 60, // minutes
  bufferTime: 15, // minutes between appointments
};

interface AvailabilityRequest {
  date: string;
  customerLocation?: {
    lat: number;
    lng: number;
    address: string;
    postalCode: string;
    city: string;
  };
  serviceType?: string;
  duration?: number;
  maxResults?: number;
}

/**
 * Enhanced Availability Checking Function
 * 
 * Features:
 * - Location-based availability calculation
 * - Service area validation (Limburg)
 * - Route optimization integration
 * - Sales team calendar filtering
 * - Comprehensive validation and error handling
 * 
 * Endpoint: /.netlify/functions/advanced-availability
 * Methods: GET, POST
 * 
 * GET Query params:
 * - date (required): YYYY-MM-DD format
 * - lat, lng (optional): Customer coordinates
 * - postalCode (optional): Dutch postal code
 * - serviceType (optional): Type of service
 * - duration (optional): Service duration in minutes
 * - maxResults (optional): Maximum slots to return
 * 
 * POST Body:
 * {
 *   "date": "2024-01-15",
 *   "customerLocation": {
 *     "lat": 50.8514,
 *     "lng": 5.6909,
 *     "address": "Hoofdstraat 123",
 *     "postalCode": "6221 AB",
 *     "city": "Maastricht"
 *   },
 *   "serviceType": "installation",
 *   "duration": 120,
 *   "maxResults": 10
 * }
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('GET, POST, OPTIONS');
  }

  // Allow both GET and POST requests
  if (!['GET', 'POST'].includes(event.httpMethod || '')) {
    return createErrorResponse(405, 'Method not allowed', {
      allowedMethods: ['GET', 'POST', 'OPTIONS']
    });
  }

  const startTime = Date.now();
  let requestData: AvailabilityRequest;

  try {
    // Parse request data
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      requestData = {
        date: params.date || '',
        customerLocation: params.lat && params.lng ? {
          lat: parseFloat(params.lat),
          lng: parseFloat(params.lng),
          address: params.address || '',
          postalCode: params.postalCode || '',
          city: params.city || '',
        } : undefined,
        serviceType: params.serviceType,
        duration: params.duration ? parseInt(params.duration) : undefined,
        maxResults: params.maxResults ? parseInt(params.maxResults) : undefined,
      };
    } else {
      // POST request
      if (!event.body) {
        return createErrorResponse(400, 'Request body is required for POST requests');
      }

      try {
        requestData = JSON.parse(event.body);
      } catch (parseError) {
        return createErrorResponse(400, 'Invalid JSON in request body', {
          details: 'Request body must be valid JSON'
        });
      }
    }

    // Validate request data
    let validatedData;
    try {
      validatedData = availabilityQuerySchema.parse(requestData);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return createErrorResponse(400, 'Validation error', {
          details: validationError.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          }))
        });
      }
      throw validationError;
    }

    // Parse and validate the date
    const requestedDate = parseISO(validatedData.date);
    
    if (!isValid(requestedDate)) {
      return createErrorResponse(400, 'Invalid date format', {
        message: 'Date must be a valid date in YYYY-MM-DD format',
        received: validatedData.date
      });
    }

    // Convert to Dutch timezone
    const amsterdamDate = toZonedTime(requestedDate, 'Europe/Amsterdam');
    const today = startOfDay(new Date());
    const requestedDay = startOfDay(amsterdamDate);

    // Validate date constraints
    if (requestedDay < today) {
      return createErrorResponse(400, 'Invalid date', {
        message: 'Cannot book appointments in the past',
        requestedDate: format(requestedDay, 'yyyy-MM-dd')
      });
    }

    if (requestedDay > addDays(today, 90)) {
      return createErrorResponse(400, 'Invalid date', {
        message: 'Cannot book appointments more than 90 days in advance',
        maxDate: format(addDays(today, 90), 'yyyy-MM-dd')
      });
    }

    // Check if it's a business day
    if (isWeekend(amsterdamDate) || !BUSINESS_HOURS.workDays.includes(amsterdamDate.getDay())) {
      return createResponse(200, {
        success: true,
        date: format(amsterdamDate, 'yyyy-MM-dd'),
        availableSlots: [],
        message: 'No service available on weekends',
        metadata: {
          isBusinessDay: false,
          dayOfWeek: amsterdamDate.getDay(),
        }
      });
    }

    // Service area validation if location provided
    let serviceAreaValidation = null;
    if (validatedData.customerLocation) {
      try {
        serviceAreaValidation = await validateServiceArea({
          street: validatedData.customerLocation.address,
          postalCode: validatedData.customerLocation.postalCode,
          city: validatedData.customerLocation.city,
          houseNumber: '',
        });

        if (!serviceAreaValidation.isValid) {
          return createResponse(200, {
            success: true,
            date: format(amsterdamDate, 'yyyy-MM-dd'),
            availableSlots: [],
            message: serviceAreaValidation.message || 'Location outside service area',
            serviceArea: {
              isInServiceArea: false,
              province: 'Limburg',
              postalCodeRange: '5800-6999'
            }
          });
        }
      } catch (validationError) {
        console.warn('Service area validation failed:', validationError);
        // Continue without strict validation in case of API issues
      }
    }

    // Get existing appointments for the day (sales team only)
    const dayStart = startOfDay(amsterdamDate);
    const dayEnd = endOfDay(amsterdamDate);

    const [existingAppointments, blockedDates] = await Promise.all([
      prisma.afspraak.findMany({
        where: {
          datum: {
            gte: dayStart,
            lte: dayEnd,
          },
          status: {
            notIn: ['geannuleerd', 'niet_verschenen']
          },
          colorId: SALES_TEAM_COLOR_ID, // Only sales team appointments
        },
        include: {
          customer: {
            select: {
              latitude: true,
              longitude: true,
              address: true,
              postalCode: true,
              city: true,
            }
          },
          lead: {
            select: {
              latitude: true,
              longitude: true,
              adres: true,
              postcode: true,
              stad: true,
            }
          }
        },
        orderBy: {
          tijd: 'asc',
        }
      }),
      
      // Check for blocked dates
      prisma.blockedDate.findFirst({
        where: {
          date: dayStart,
        }
      })
    ]);

    // If date is blocked, return no availability
    if (blockedDates) {
      return createResponse(200, {
        success: true,
        date: format(amsterdamDate, 'yyyy-MM-dd'),
        availableSlots: [],
        message: 'Date is blocked for appointments',
        metadata: {
          blockedReason: blockedDates.reason || 'Administrative block',
          isBlocked: true,
        }
      });
    }

    // Check daily appointment limit
    if (existingAppointments.length >= BUSINESS_HOURS.maxAppointmentsPerDay) {
      return createResponse(200, {
        success: true,
        date: format(amsterdamDate, 'yyyy-MM-dd'),
        availableSlots: [],
        message: `Day is fully booked (${BUSINESS_HOURS.maxAppointmentsPerDay} appointments maximum)`,
        metadata: {
          currentAppointments: existingAppointments.length,
          maxAppointments: BUSINESS_HOURS.maxAppointmentsPerDay,
          isFull: true,
        }
      });
    }

    // Calculate available slots
    let availableSlots = [];
    const serviceDuration = validatedData.duration || BUSINESS_HOURS.defaultDuration;
    const maxResults = validatedData.maxResults || 20;

    if (validatedData.customerLocation) {
      // Location-based availability using route optimization
      availableSlots = await findAvailableSlots(
        amsterdamDate,
        {
          lat: validatedData.customerLocation.lat,
          lng: validatedData.customerLocation.lng,
          address: validatedData.customerLocation.address,
          postalCode: validatedData.customerLocation.postalCode,
          city: validatedData.customerLocation.city,
        },
        serviceDuration,
        existingAppointments.filter(apt => {
          const location = apt.customer || apt.lead;
          return location && location.latitude != null && location.longitude != null;
        }).map(apt => {
          const location = apt.customer || apt.lead;
          return {
            id: apt.id,
            date: amsterdamDate,
            startTime: apt.tijd,
            endTime: format(addMinutes(parseISO(`${format(amsterdamDate, 'yyyy-MM-dd')}T${apt.tijd}:00`), serviceDuration), 'HH:mm'),
            summary: `Appointment - ${apt.serviceType}`,
            colorId: apt.colorId || '5',
            start: new Date(`${format(amsterdamDate, 'yyyy-MM-dd')}T${apt.tijd}:00`),
            end: new Date(`${format(amsterdamDate, 'yyyy-MM-dd')}T${apt.tijd}:00`),
            location: {
              lat: location!.latitude!,
              lng: location!.longitude!,
              address: (location as any).address || (location as any).adres || '',
              postalCode: (location as any).postalCode || (location as any).postcode || '',
              city: (location as any).city || (location as any).stad || '',
            },
          };
        })
      );
    } else {
      // Basic time-based availability without location optimization
      availableSlots = await calculateBasicAvailability(
        amsterdamDate,
        existingAppointments,
        serviceDuration
      );
    }

    // Limit results
    const limitedSlots = availableSlots.slice(0, maxResults);

    // Prepare response
    const response = {
      success: true,
      date: format(amsterdamDate, 'yyyy-MM-dd'),
      timezone: 'Europe/Amsterdam',
      availableSlots: limitedSlots.map(slot => ({
        startTime: slot.startTime,
        endTime: slot.endTime,
        duration: serviceDuration,
        efficiency: slot.efficiency || 100,
        routeInfo: slot.routeInfo || {},
        displayTime: `${slot.startTime} - ${slot.endTime}`,
      })),
      metadata: {
        businessHours: BUSINESS_HOURS,
        currentAppointments: existingAppointments.length,
        maxAppointments: BUSINESS_HOURS.maxAppointmentsPerDay,
        slotsRemaining: BUSINESS_HOURS.maxAppointmentsPerDay - existingAppointments.length,
        serviceType: validatedData.serviceType,
        duration: serviceDuration,
        hasLocationOptimization: !!validatedData.customerLocation,
        serviceArea: serviceAreaValidation ? {
          isInServiceArea: serviceAreaValidation.isValid,
          province: serviceAreaValidation.province || 'Limburg',
          postalCodeRange: '5800-6999'
        } : null,
        processingTime: Date.now() - startTime,
      },
      recommendedSlots: limitedSlots
        .filter(slot => (slot.efficiency || 0) >= 80)
        .slice(0, 3)
        .map(slot => ({
          time: slot.startTime,
          efficiency: slot.efficiency,
          reason: getEfficiencyReason(slot.efficiency || 0),
        })),
    };

    return createResponse(200, response, {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Processing-Time': `${Date.now() - startTime}ms`,
    });

  } catch (error) {
    console.error('Advanced availability check error:', error);
    
    // Log detailed error information for debugging
    const errorDetails = {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      requestData: null,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
    };

    console.error('Error details:', errorDetails);
    
    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while checking availability. Please try again later.',
      requestId: `avail_${Date.now()}`,
    });
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Calculate basic availability without location optimization
 */
async function calculateBasicAvailability(
  date: Date,
  existingAppointments: any[],
  duration: number
): Promise<any[]> {
  const slots = [];
  const [startHour, startMin] = BUSINESS_HOURS.start.split(':').map(Number);
  const [endHour, endMin] = BUSINESS_HOURS.end.split(':').map(Number);
  
  let currentTime = new Date(date);
  currentTime.setHours(startHour, startMin, 0, 0);
  
  const endTime = new Date(date);
  endTime.setHours(endHour, endMin, 0, 0);
  
  while (currentTime.getTime() + (duration * 60 * 1000) <= endTime.getTime()) {
    const slotStart = format(currentTime, 'HH:mm');
    const slotEnd = format(new Date(currentTime.getTime() + (duration * 60 * 1000)), 'HH:mm');
    
    // Check if slot conflicts with existing appointments
    const hasConflict = existingAppointments.some(apt => {
      const aptTime = apt.tijd;
      const aptStart = new Date(`${format(date, 'yyyy-MM-dd')}T${aptTime}:00`);
      const aptEnd = new Date(aptStart.getTime() + (60 * 60 * 1000)); // Assume 1 hour appointments
      
      const slotStartTime = new Date(`${format(date, 'yyyy-MM-dd')}T${slotStart}:00`);
      const slotEndTime = new Date(`${format(date, 'yyyy-MM-dd')}T${slotEnd}:00`);
      
      return (slotStartTime < aptEnd && slotEndTime > aptStart);
    });
    
    if (!hasConflict) {
      slots.push({
        startTime: slotStart,
        endTime: slotEnd,
        efficiency: 95, // High efficiency for basic slots
      });
    }
    
    // Move to next 30-minute slot
    currentTime.setMinutes(currentTime.getMinutes() + 30);
  }
  
  return slots;
}

/**
 * Get efficiency reason text
 */
function getEfficiencyReason(efficiency: number): string {
  if (efficiency >= 95) return 'Optimale route efficiency';
  if (efficiency >= 85) return 'Zeer goede route efficiency';
  if (efficiency >= 70) return 'Goede route efficiency';
  if (efficiency >= 50) return 'Acceptabele route efficiency';
  return 'Lagere route efficiency';
}