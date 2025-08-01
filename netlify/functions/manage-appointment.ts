import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { updateCalendarEvent, deleteCalendarEvent } from '../../lib/google-calendar';
import { markSlotAsAvailable, markSlotAsBooked } from '../../lib/availability';
import { z, ZodError } from 'zod';
import { parseISO, isValid, format, addHours } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import jwt from 'jsonwebtoken';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';

const prisma = new PrismaClient();

// Validation schemas
const updateAppointmentSchema = z.object({
  appointmentId: z.string().cuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  serviceType: z.enum(['installation', 'maintenance', 'repair', 'consultation', 'installatie', 'onderhoud', 'reparatie', 'consultatie']).optional(),
  notes: z.string().optional(),
  bookingToken: z.string().min(1, 'Booking token is required'),
});

const cancelAppointmentSchema = z.object({
  appointmentId: z.string().cuid(),
  reason: z.string().optional(),
  bookingToken: z.string().min(1, 'Booking token is required'),
});

/**
 * Netlify Function to manage appointments (update or cancel)
 * Endpoint: /.netlify/functions/manage-appointment
 * Methods: PATCH (update), DELETE (cancel)
 * 
 * Updates or cancels appointments with Google Calendar sync
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('PATCH, DELETE, OPTIONS');
  }

  // Only allow PATCH and DELETE requests
  if (!['PATCH', 'DELETE'].includes(event.httpMethod)) {
    return createErrorResponse(405, 'Method not allowed');
  }

  try {
    // Parse request body
    if (!event.body) {
      return createErrorResponse(400, 'Request body is required');
    }

    const body = JSON.parse(event.body);
    const tokenSecret = process.env.JWT_SECRET || 'your-secret-key';

    // Handle appointment update
    if (event.httpMethod === 'PATCH') {
      const validatedData = updateAppointmentSchema.parse(body);

      // Verify booking token
      let tokenPayload: any;
      try {
        tokenPayload = jwt.verify(validatedData.bookingToken, tokenSecret) as any;
      } catch (error) {
        return createErrorResponse(401, 'Invalid or expired booking token');
      }

      // Fetch existing appointment
      const appointment = await prisma.afspraak.findUnique({
        where: { id: validatedData.appointmentId },
        include: { customer: true, lead: true }
      });

      if (!appointment) {
        return createErrorResponse(404, 'Appointment not found');
      }

      // Verify authorization
      if (appointment.leadId !== tokenPayload.leadId) {
        return createErrorResponse(403, 'Unauthorized to modify this appointment');
      }

      // Prepare update data
      let updateData: any = {};
      let newDateTime: Date | null = null;
      let oldDateTime: Date = appointment.datum;

      // Handle date/time change
      if (validatedData.date || validatedData.startTime) {
        const newDate = validatedData.date || format(appointment.datum, 'yyyy-MM-dd');
        const newTime = validatedData.startTime || appointment.tijd;

        // Parse new datetime
        const appointmentDate = parseISO(newDate);
        const [hours, minutes] = newTime.split(':').map(Number);
        const amsterdamDateTime = new Date(appointmentDate);
        amsterdamDateTime.setHours(hours, minutes, 0, 0);
        
        newDateTime = fromZonedTime(amsterdamDateTime, 'Europe/Amsterdam');

        // Check if new slot is available
        const conflictingAppointment = await prisma.afspraak.findFirst({
          where: {
            datum: newDateTime,
            status: {
              in: ['gepland', 'bevestigd']
            },
            id: {
              not: appointment.id
            }
          }
        });

        if (conflictingAppointment) {
          return createErrorResponse(409, 'Time slot not available', {
            message: 'The selected time slot is already booked. Please choose a different time.'
          });
        }

        updateData.datum = newDateTime;
        updateData.tijd = newTime;
      }

      // Update other fields
      if (validatedData.serviceType) updateData.serviceType = validatedData.serviceType;
      if (validatedData.notes !== undefined) updateData.beschrijving = validatedData.notes;

      // Update appointment in database
      const updatedAppointment = await prisma.afspraak.update({
        where: { id: appointment.id },
        data: updateData,
        include: { customer: true, lead: true }
      });

      // Update Google Calendar event if exists
      if (appointment.googleEventId) {
        try {
          await updateCalendarEvent(appointment.googleEventId, updatedAppointment);

          // Update availability slots if time changed
          if (newDateTime) {
            await markSlotAsAvailable(oldDateTime, appointment.tijd);
            await markSlotAsBooked(newDateTime, updateData.tijd);
          }
        } catch (calendarError) {
          console.error('Error updating Google Calendar event:', calendarError);
        }
      }

      return createResponse(200, {
        success: true,
        appointment: {
          id: updatedAppointment.id,
          date: format(toZonedTime(updatedAppointment.datum, 'Europe/Amsterdam'), 'yyyy-MM-dd'),
          time: updatedAppointment.tijd,
          serviceType: updatedAppointment.serviceType,
          status: updatedAppointment.status,
          notes: updatedAppointment.beschrijving,
          timezone: 'Europe/Amsterdam',
        },
        message: 'Appointment successfully updated',
      });
    }

    // Handle appointment cancellation
    if (event.httpMethod === 'DELETE') {
      const validatedData = cancelAppointmentSchema.parse(body);

      // Verify booking token
      let tokenPayload: any;
      try {
        tokenPayload = jwt.verify(validatedData.bookingToken, tokenSecret) as any;
      } catch (error) {
        return createErrorResponse(401, 'Invalid or expired booking token');
      }

      // Fetch appointment
      const appointment = await prisma.afspraak.findUnique({
        where: { id: validatedData.appointmentId },
        include: { customer: true }
      });

      if (!appointment) {
        return createErrorResponse(404, 'Appointment not found');
      }

      // Verify authorization
      if (appointment.leadId !== tokenPayload.leadId) {
        return createErrorResponse(403, 'Unauthorized to cancel this appointment');
      }

      // Update appointment status
      await prisma.afspraak.update({
        where: { id: appointment.id },
        data: { 
          status: 'geannuleerd',
          beschrijving: validatedData.reason 
            ? `${appointment.beschrijving}\nCancellation reason: ${validatedData.reason}`.trim()
            : appointment.beschrijving
        }
      });

      // Delete Google Calendar event if exists
      if (appointment.googleEventId) {
        try {
          await deleteCalendarEvent(appointment.googleEventId);
        } catch (calendarError) {
          console.error('Error deleting Google Calendar event:', calendarError);
        }
      }

      // Mark slot as available
      await markSlotAsAvailable(appointment.datum, appointment.tijd);

      return createResponse(200, {
        success: true,
        message: 'Appointment successfully cancelled',
        appointmentId: appointment.id,
      });
    }

    // This should never be reached due to method validation above
    return createErrorResponse(500, 'Internal server error');

  } catch (error) {
    console.error('Error managing appointment:', error);
    
    // Handle validation errors
    if (error instanceof ZodError) {
      return createErrorResponse(400, 'Validation error', {
        details: error.issues
      });
    }

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while managing the appointment. Please try again later.'
    });
  } finally {
    // Ensure database connection is closed
    await prisma.$disconnect();
  }
};