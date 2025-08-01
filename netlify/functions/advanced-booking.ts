import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { parseISO, isValid, format, startOfDay, addMinutes, differenceInMinutes } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import { validateServiceArea } from '../../lib/boundary-validator';
import { googleMaps } from '../../lib/google-maps';
import { createCalendarEvent } from '../../lib/google-calendar';

const prisma = new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

// Validation schemas
const customerSchema = z.object({
  customerType: z.enum(['residential', 'business']),
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
  company: z.string().max(200).optional(),
  email: z.string().email().max(320).toLowerCase(),
  phone: z.string().regex(/^(\+31|0)[\s-]?[1-9][\s-]?(\d[\s-]?){8}$/, 'Invalid Dutch phone number'),
  address: z.string().min(1).max(500).trim(),
  houseNumber: z.string().min(1).max(10).trim(),
  houseNumberExt: z.string().max(10).optional(),
  postalCode: z.string().regex(/^\d{4}\s?[A-Z]{2}$/i, 'Invalid Dutch postal code'),
  city: z.string().min(1).max(100).trim(),
  notes: z.string().max(1000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

const bookingSchema = z.object({
  serviceType: z.enum(['installation', 'maintenance', 'repair', 'inspection']),
  description: z.string().max(1000).optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  duration: z.number().min(30).max(480).optional(), // 30 minutes to 8 hours
  priority: z.number().min(0).max(10).optional(),
  customer: customerSchema,
  // Optional fields for advanced booking
  preferredTechnician: z.string().max(100).optional(),
  urgency: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  followUpRequired: z.boolean().optional(),
  equipmentNeeded: z.array(z.string().max(100)).optional(),
  accessInstructions: z.string().max(500).optional(),
});

const SALES_TEAM_COLOR_ID = '5';
const BUSINESS_HOURS = {
  start: '09:30',
  end: '16:00',
  workDays: [1, 2, 3, 4, 5],
  maxAppointmentsPerDay: 5,
  defaultDuration: 60,
  bufferTime: 15,
};

interface BookingRequest {
  serviceType: string;
  description?: string;
  scheduledDate: string;
  scheduledTime: string;
  duration?: number;
  priority?: number;
  customer: {
    customerType: 'residential' | 'business';
    firstName: string;
    lastName: string;
    company?: string;
    email: string;
    phone: string;
    address: string;
    houseNumber: string;
    houseNumberExt?: string;
    postalCode: string;
    city: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
  };
  preferredTechnician?: string;
  urgency?: string;
  followUpRequired?: boolean;
  equipmentNeeded?: string[];
  accessInstructions?: string;
}

/**
 * Advanced Appointment Booking Function
 * 
 * Features:
 * - Comprehensive input validation with Zod
 * - Service area validation (Limburg)
 * - Address geocoding and verification
 * - Conflict detection and prevention
 * - Google Calendar integration
 * - Customer data management (upsert)
 * - Transactional database operations
 * - Email notifications (ready for integration)
 * - Audit logging
 * 
 * Endpoint: /.netlify/functions/advanced-booking
 * Method: POST
 * 
 * Request Body:
 * {
 *   "serviceType": "installation",
 *   "description": "New airco unit installation",
 *   "scheduledDate": "2024-01-15",
 *   "scheduledTime": "10:00",
 *   "duration": 120,
 *   "customer": {
 *     "customerType": "residential",
 *     "firstName": "Jan",
 *     "lastName": "Jansen",
 *     "email": "jan@example.nl",
 *     "phone": "06-12345678",
 *     "address": "Hoofdstraat",
 *     "houseNumber": "123",
 *     "postalCode": "6221 AB",
 *     "city": "Maastricht"
 *   }
 * }
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('POST, OPTIONS');
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return createErrorResponse(405, 'Method not allowed', {
      allowedMethods: ['POST', 'OPTIONS']
    });
  }

  const startTime = Date.now();
  let bookingData: BookingRequest | null = null;
  let bookingId: string | null = null;

  try {
    // Parse request body
    if (!event.body) {
      return createErrorResponse(400, 'Request body is required');
    }

    try {
      bookingData = JSON.parse(event.body);
    } catch (parseError) {
      return createErrorResponse(400, 'Invalid JSON in request body', {
        details: 'Request body must be valid JSON'
      });
    }

    // Validate request data
    let validatedData;
    try {
      validatedData = bookingSchema.parse(bookingData);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return createErrorResponse(400, 'Validation error', {
          details: validationError.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
            received: 'received' in issue ? issue.received : undefined,
          }))
        });
      }
      throw validationError;
    }

    // Parse and validate the date/time
    const appointmentDate = parseISO(validatedData.scheduledDate);
    
    if (!isValid(appointmentDate)) {
      return createErrorResponse(400, 'Invalid appointment date', {
        message: 'Date must be a valid date in YYYY-MM-DD format',
        received: validatedData.scheduledDate
      });
    }

    // Validate time format
    const [hours, minutes] = validatedData.scheduledTime.split(':').map(Number);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return createErrorResponse(400, 'Invalid appointment time', {
        message: 'Time must be in valid HH:MM format (24-hour)',
        received: validatedData.scheduledTime
      });
    }

    // Convert to Dutch timezone
    const amsterdamDate = toZonedTime(appointmentDate, 'Europe/Amsterdam');
    const appointmentDateTime = new Date(amsterdamDate);
    appointmentDateTime.setHours(hours, minutes, 0, 0);

    // Business hours validation
    const businessStart = new Date(amsterdamDate);
    const [startHour, startMin] = BUSINESS_HOURS.start.split(':').map(Number);
    businessStart.setHours(startHour, startMin, 0, 0);

    const businessEnd = new Date(amsterdamDate);
    const [endHour, endMin] = BUSINESS_HOURS.end.split(':').map(Number);
    businessEnd.setHours(endHour, endMin, 0, 0);

    if (appointmentDateTime < businessStart || appointmentDateTime > businessEnd) {
      return createErrorResponse(400, 'Appointment time outside business hours', {
        message: `Appointments must be scheduled between ${BUSINESS_HOURS.start} and ${BUSINESS_HOURS.end}`,
        businessHours: {
          start: BUSINESS_HOURS.start,
          end: BUSINESS_HOURS.end,
          workDays: BUSINESS_HOURS.workDays,
        }
      });
    }

    // Check if it's a business day
    if (!BUSINESS_HOURS.workDays.includes(amsterdamDate.getDay())) {
      return createErrorResponse(400, 'Appointment on non-business day', {
        message: 'Appointments can only be scheduled Monday through Friday',
        requestedDay: amsterdamDate.getDay(),
        businessDays: BUSINESS_HOURS.workDays,
      });
    }

    // Service area validation
    const fullAddress = `${validatedData.customer.address} ${validatedData.customer.houseNumber}${validatedData.customer.houseNumberExt || ''}`;
    
    let serviceAreaValidation;
    try {
      serviceAreaValidation = await validateServiceArea({
        street: fullAddress,
        postalCode: validatedData.customer.postalCode,
        city: validatedData.customer.city,
        houseNumber: validatedData.customer.houseNumber,
        houseNumberExt: validatedData.customer.houseNumberExt,
      });

      if (!serviceAreaValidation.isValid) {
        return createErrorResponse(400, 'Address outside service area', {
          message: serviceAreaValidation.message || 'This address is outside our service area in Limburg',
          serviceArea: {
            province: 'Limburg',
            postalCodeRange: '5800-6999',
            isInServiceArea: false,
          }
        });
      }
    } catch (validationError) {
      console.warn('Service area validation failed:', validationError);
      return createErrorResponse(500, 'Service area validation failed', {
        message: 'Unable to validate service area. Please try again later.'
      });
    }

    // Geocode address if coordinates not provided
    let customerCoordinates = {
      latitude: validatedData.customer.latitude,
      longitude: validatedData.customer.longitude,
    };

    if (!customerCoordinates.latitude || !customerCoordinates.longitude) {
      try {
        const geocodeResult = await googleMaps.geocodeAddress({
          street: validatedData.customer.address,
          houseNumber: validatedData.customer.houseNumber,
          houseNumberExt: validatedData.customer.houseNumberExt,
          postalCode: validatedData.customer.postalCode,
          city: validatedData.customer.city,
          country: 'Netherlands'
        });

        if (geocodeResult) {
          customerCoordinates = {
            latitude: geocodeResult.latitude,
            longitude: geocodeResult.longitude,
          };
        } else {
          console.warn('Geocoding failed for address:', fullAddress);
          // Continue without coordinates, but log the issue
        }
      } catch (geocodeError) {
        console.warn('Geocoding error:', geocodeError);
        // Continue without coordinates
      }
    }

    // Check for appointment conflicts and daily limits using a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Check daily appointment limit
      const dayStart = startOfDay(amsterdamDate);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const existingAppointments = await tx.afspraak.findMany({
        where: {
          datum: {
            gte: dayStart,
            lte: dayEnd,
          },
          status: {
            notIn: ['geannuleerd', 'niet_verschenen']
          },
          colorId: SALES_TEAM_COLOR_ID,
        },
        orderBy: {
          tijd: 'asc',
        }
      });

      // Check daily limit
      if (existingAppointments.length >= BUSINESS_HOURS.maxAppointmentsPerDay) {
        throw new Error(`DAILY_LIMIT_EXCEEDED:${BUSINESS_HOURS.maxAppointmentsPerDay}`);
      }

      // Check for time conflicts
      const serviceDuration = validatedData.duration || BUSINESS_HOURS.defaultDuration;
      const appointmentEnd = addMinutes(appointmentDateTime, serviceDuration);

      const timeConflicts = existingAppointments.filter(apt => {
        const existingStart = new Date(`${format(amsterdamDate, 'yyyy-MM-dd')}T${apt.tijd}:00`);
        const existingEnd = addMinutes(existingStart, 60); // Assume 60 minutes for existing appointments

        return (
          (appointmentDateTime >= existingStart && appointmentDateTime < existingEnd) ||
          (appointmentEnd > existingStart && appointmentEnd <= existingEnd) ||
          (appointmentDateTime <= existingStart && appointmentEnd >= existingEnd)
        );
      });

      if (timeConflicts.length > 0) {
        throw new Error(`TIME_CONFLICT:${timeConflicts[0].tijd}`);
      }

      // Check for blocked dates
      const blockedDate = await tx.blockedDate.findFirst({
        where: {
          date: dayStart,
        }
      });

      if (blockedDate) {
        throw new Error(`DATE_BLOCKED:${blockedDate.reason || 'Administrative block'}`);
      }

      // Upsert customer
      const customer = await tx.customer.upsert({
        where: { email: validatedData.customer.email },
        update: {
          firstName: validatedData.customer.firstName,
          lastName: validatedData.customer.lastName,
          phone: validatedData.customer.phone,
          company: validatedData.customer.company,
          customerType: validatedData.customer.customerType === 'business' ? 'zakelijk' : 'particulier',
          address: fullAddress,
          postalCode: validatedData.customer.postalCode,
          city: validatedData.customer.city,
          notes: validatedData.customer.notes,
          latitude: customerCoordinates.latitude,
          longitude: customerCoordinates.longitude,
          geocodedAt: customerCoordinates.latitude ? new Date() : undefined,
          updatedAt: new Date(),
        },
        create: {
          email: validatedData.customer.email,
          firstName: validatedData.customer.firstName,
          lastName: validatedData.customer.lastName,
          phone: validatedData.customer.phone,
          company: validatedData.customer.company,
          customerType: validatedData.customer.customerType === 'business' ? 'zakelijk' : 'particulier',
          address: fullAddress,
          postalCode: validatedData.customer.postalCode,
          city: validatedData.customer.city,
          notes: validatedData.customer.notes,
          latitude: customerCoordinates.latitude,
          longitude: customerCoordinates.longitude,
          geocodedAt: customerCoordinates.latitude ? new Date() : undefined,
        },
      });

      // Generate unique booking ID
      bookingId = `BK${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

      // Create appointment
      const appointment = await tx.afspraak.create({
        data: {
          id: bookingId,
          customerId: customer.id,
          serviceType: validatedData.serviceType as any,
          beschrijving: validatedData.description,
          datum: dayStart,
          tijd: validatedData.scheduledTime,
          duur: serviceDuration,
          status: 'gepland',
          prioriteit: validatedData.priority || 0,
          colorId: SALES_TEAM_COLOR_ID,
          locatie: fullAddress,
          createdAt: new Date(),
        },
      });

      return { customer, appointment };
    });

    // Create Google Calendar event (outside transaction to avoid long-running operations)
    let calendarEventId = null;
    try {
      calendarEventId = await createCalendarEvent(result.appointment);

      // Update appointment with Google Calendar event ID
      await prisma.afspraak.update({
        where: { id: bookingId! },
        data: { googleEventId: calendarEventId },
      });

    } catch (calendarError) {
      console.error('Failed to create Google Calendar event:', calendarError);
      // Don't fail the booking if calendar creation fails
    }

    // Prepare response
    const response = {
      success: true,
      bookingId: bookingId,
      appointment: {
        id: result.appointment.id,
        serviceType: result.appointment.serviceType,
        date: format(amsterdamDate, 'yyyy-MM-dd'),
        time: result.appointment.tijd,
        duration: result.appointment.duur,
        status: result.appointment.status,
        description: result.appointment.beschrijving,
        calendarEventId: calendarEventId,
      },
      customer: {
        id: result.customer.id,
        name: `${result.customer.firstName} ${result.customer.lastName}`,
        email: result.customer.email,
        phone: result.customer.phone,
        address: `${fullAddress}, ${validatedData.customer.postalCode} ${validatedData.customer.city}`,
        customerType: result.customer.customerType,
      },
      serviceArea: {
        isInServiceArea: true,
        province: 'Limburg',
        validation: serviceAreaValidation.message,
      },
      metadata: {
        processingTime: Date.now() - startTime,
        hasCalendarEvent: !!calendarEventId,
        coordinates: customerCoordinates.latitude ? {
          lat: customerCoordinates.latitude,
          lng: customerCoordinates.longitude,
        } : null,
        businessHours: BUSINESS_HOURS,
      },
      nextSteps: [
        'U ontvangt een bevestiging per e-mail',
        'Een kalender uitnodiging wordt verstuurd',
        'Onze technicus neemt contact op voor eventuele vragen',
        calendarEventId ? 'De afspraak is toegevoegd aan uw agenda' : 'Agenda synchronisatie wordt verwerkt',
      ],
    };

    return createResponse(201, response, {
      'X-Booking-ID': bookingId!,
      'X-Processing-Time': `${Date.now() - startTime}ms`,
    });

  } catch (error) {
    console.error('Advanced booking error:', error);

    // Handle specific business logic errors
    if (error instanceof Error) {
      if (error.message.startsWith('DAILY_LIMIT_EXCEEDED:')) {
        const limit = error.message.split(':')[1];
        return createErrorResponse(409, 'Daily appointment limit reached', {
          message: `Maximum ${limit} appointments per day already scheduled`,
          maxAppointments: parseInt(limit),
          suggestedAction: 'Please choose a different date',
        });
      }

      if (error.message.startsWith('TIME_CONFLICT:')) {
        const conflictTime = error.message.split(':')[1];
        return createErrorResponse(409, 'Time slot already booked', {
          message: 'The requested time slot is no longer available',
          conflictTime: conflictTime,
          suggestedAction: 'Please choose a different time',
        });
      }

      if (error.message.startsWith('DATE_BLOCKED:')) {
        const reason = error.message.split(':')[1];
        return createErrorResponse(409, 'Date not available', {
          message: 'The requested date is not available for appointments',
          reason: reason,
          suggestedAction: 'Please choose a different date',
        });
      }
    }

    // Log detailed error information
    const errorDetails = {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      bookingData: bookingData,
      bookingId: bookingId,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
    };

    console.error('Booking error details:', errorDetails);

    return createErrorResponse(500, 'Booking failed', {
      message: 'An error occurred while processing your booking. Please try again later.',
      bookingId: bookingId || `err_${Date.now()}`,
    });
  } finally {
    await prisma.$disconnect();
  }
};