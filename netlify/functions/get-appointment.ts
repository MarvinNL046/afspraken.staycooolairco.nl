import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z, ZodError } from 'zod';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import jwt from 'jsonwebtoken';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';

const prisma = new PrismaClient();

// Validation schema
const getAppointmentSchema = z.object({
  appointmentId: z.string().cuid().optional(),
  bookingToken: z.string().min(1, 'Booking token is required'),
});

/**
 * Netlify Function to get appointment details
 * Endpoint: /.netlify/functions/get-appointment
 * Method: GET
 * Query params: appointmentId (optional), bookingToken (required)
 * 
 * Returns appointment details with Dutch timezone support
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('GET, OPTIONS');
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return createErrorResponse(405, 'Method not allowed');
  }

  try {
    // Validate query parameters
    const queryParams = {
      appointmentId: event.queryStringParameters?.appointmentId,
      bookingToken: event.queryStringParameters?.bookingToken || event.headers?.authorization?.replace('Bearer ', ''),
    };

    const validatedData = getAppointmentSchema.parse(queryParams);

    // Verify booking token
    const tokenSecret = process.env.JWT_SECRET || 'your-secret-key';
    let tokenPayload: any;
    
    try {
      tokenPayload = jwt.verify(validatedData.bookingToken, tokenSecret) as any;
    } catch (error) {
      return createErrorResponse(401, 'Invalid or expired booking token');
    }

    // Build query based on available parameters
    const whereClause: any = {
      leadId: tokenPayload.leadId,
      status: {
        in: ['gepland', 'bevestigd']
      }
    };

    // If specific appointment ID is provided, add it to the query
    if (validatedData.appointmentId) {
      whereClause.id = validatedData.appointmentId;
    }

    // Fetch appointments
    const appointments = await prisma.afspraak.findMany({
      where: whereClause,
      include: {
        customer: true,
        lead: {
          select: {
            email: true,
            telefoon: true,
          }
        }
      },
      orderBy: {
        datum: 'asc'
      }
    });

    if (appointments.length === 0) {
      return createErrorResponse(404, 'No appointments found', {
        message: validatedData.appointmentId 
          ? 'The requested appointment was not found or you do not have access to it.'
          : 'No active appointments found for this account.'
      });
    }

    // Format response
    const formattedAppointments = appointments.map(appointment => {
      const amsterdamDate = toZonedTime(appointment.datum, 'Europe/Amsterdam');
      const [hours, minutes] = appointment.tijd.split(':').map(Number);
      const endHours = hours + 2; // 2-hour appointment slots
      const endTime = `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

      return {
        id: appointment.id,
        date: format(amsterdamDate, 'yyyy-MM-dd'),
        time: appointment.tijd,
        endTime: endTime,
        serviceType: appointment.serviceType,
        status: appointment.status,
        notes: appointment.beschrijving,
        customer: {
          firstName: appointment.customer!.firstName,
          lastName: appointment.customer!.lastName,
          email: appointment.customer!.email,
          phone: appointment.customer!.phone,
          address: appointment.customer!.address,
          city: appointment.customer!.city,
          postalCode: appointment.customer!.postalCode,
        },
        contact: {
          email: appointment.lead?.email || '',
          phone: appointment.lead?.telefoon || '',
        },
        timezone: 'Europe/Amsterdam',
        googleCalendarSynced: !!appointment.googleEventId,
        createdAt: appointment.createdAt.toISOString(),
      };
    });

    // Return single appointment if specific ID was requested
    if (validatedData.appointmentId) {
      return createResponse(200, {
        success: true,
        appointment: formattedAppointments[0],
      }, {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
    }

    // Return all appointments for the lead
    return createResponse(200, {
      success: true,
      appointments: formattedAppointments,
      total: formattedAppointments.length,
    }, {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

  } catch (error) {
    console.error('Error fetching appointment:', error);
    
    // Handle validation errors
    if (error instanceof ZodError) {
      return createErrorResponse(400, 'Validation error', {
        details: error.issues
      });
    }

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while fetching appointment details. Please try again later.'
    });
  } finally {
    // Ensure database connection is closed
    await prisma.$disconnect();
  }
};