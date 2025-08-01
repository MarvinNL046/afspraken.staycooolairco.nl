import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { getCalendarEvents, createCalendarEvent, updateCalendarEvent } from '../../lib/google-calendar';
import { z, ZodError } from 'zod';
import { parseISO, startOfDay, endOfDay, addDays, format, addHours } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';

const prisma = new PrismaClient();

// Validation schema
const syncSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  direction: z.enum(['toCalendar', 'fromCalendar', 'bidirectional']).default('toCalendar'),
  apiKey: z.string().min(1, 'API key is required'),
});

/**
 * Netlify Function to sync appointments with Google Calendar
 * Endpoint: /.netlify/functions/sync-calendar
 * Method: POST
 * 
 * Syncs appointments between database and Google Calendar
 * Requires admin API key for security
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('POST, OPTIONS');
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return createErrorResponse(405, 'Method not allowed');
  }

  try {
    // Parse and validate request body
    if (!event.body) {
      return createErrorResponse(400, 'Request body is required');
    }

    const body = JSON.parse(event.body);
    const validatedData = syncSchema.parse(body);

    // Verify admin API key
    const adminApiKey = process.env.ADMIN_API_KEY || 'your-admin-api-key';
    if (validatedData.apiKey !== adminApiKey) {
      return createErrorResponse(401, 'Invalid API key');
    }

    // Parse dates
    const startDate = parseISO(validatedData.startDate);
    const endDate = validatedData.endDate ? parseISO(validatedData.endDate) : addDays(startDate, 30);

    // Convert to Amsterdam timezone for calendar queries
    const amsterdamStartDate = toZonedTime(startOfDay(startDate), 'Europe/Amsterdam');
    const amsterdamEndDate = toZonedTime(endOfDay(endDate), 'Europe/Amsterdam');

    const syncResults = {
      synced: 0,
      created: 0,
      updated: 0,
      errors: 0,
      details: [] as any[],
    };

    // Sync from database to Google Calendar
    if (validatedData.direction === 'toCalendar' || validatedData.direction === 'bidirectional') {
      // Fetch appointments from database
      const appointments = await prisma.afspraak.findMany({
        where: {
          datum: {
            gte: fromZonedTime(amsterdamStartDate, 'Europe/Amsterdam'),
            lte: fromZonedTime(amsterdamEndDate, 'Europe/Amsterdam'),
          },
          status: {
            in: ['gepland', 'bevestigd']
          }
        },
        include: {
          customer: true
        }
      });

      for (const appointment of appointments) {
        try {
          if (appointment.googleEventId) {
            // Update existing event
            await updateCalendarEvent(appointment.googleEventId, appointment);
            syncResults.updated++;
            syncResults.details.push({
              appointmentId: appointment.id,
              action: 'updated',
              googleEventId: appointment.googleEventId,
            });
          } else {
            // Create new event
            const calendarEventId = await createCalendarEvent(appointment);
            
            // Update appointment with Google event ID
            if (calendarEventId) {
              await prisma.afspraak.update({
                where: { id: appointment.id },
                data: { googleEventId: calendarEventId }
              });

              syncResults.created++;
              syncResults.details.push({
                appointmentId: appointment.id,
                action: 'created',
                googleEventId: calendarEventId,
              });
            }
          }

          syncResults.synced++;
        } catch (error) {
          console.error(`Error syncing appointment ${appointment.id}:`, error);
          syncResults.errors++;
          syncResults.details.push({
            appointmentId: appointment.id,
            action: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // Sync from Google Calendar to database
    if (validatedData.direction === 'fromCalendar' || validatedData.direction === 'bidirectional') {
      try {
        // Fetch events from Google Calendar
        const calendarEvents = await getCalendarEvents(
          fromZonedTime(amsterdamStartDate, 'Europe/Amsterdam'),
          fromZonedTime(amsterdamEndDate, 'Europe/Amsterdam')
        );

        // Get all appointments with Google event IDs for comparison
        const appointmentsWithEvents = await prisma.afspraak.findMany({
          where: {
            googleEventId: {
              not: null
            }
          },
          select: {
            id: true,
            googleEventId: true,
          }
        });

        const eventIdMap = new Map(
          appointmentsWithEvents.map(a => [a.googleEventId!, a.id])
        );

        for (const event of calendarEvents) {
          // Check if event already exists in database
          if (!eventIdMap.has(event.id!)) {
            // Log orphaned calendar events (events without corresponding appointments)
            syncResults.details.push({
              googleEventId: event.id,
              action: 'orphaned_event',
              summary: event.summary,
              start: event.start?.dateTime || event.start?.date,
              message: 'Calendar event exists without corresponding appointment in database',
            });
          }
        }
      } catch (error) {
        console.error('Error fetching calendar events:', error);
        syncResults.errors++;
        syncResults.details.push({
          action: 'calendar_fetch_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Prepare response
    const response = {
      success: true,
      summary: {
        totalSynced: syncResults.synced,
        created: syncResults.created,
        updated: syncResults.updated,
        errors: syncResults.errors,
      },
      dateRange: {
        start: format(startDate, 'yyyy-MM-dd'),
        end: format(endDate, 'yyyy-MM-dd'),
        timezone: 'Europe/Amsterdam',
      },
      direction: validatedData.direction,
      details: syncResults.details,
    };

    return createResponse(200, response);

  } catch (error) {
    console.error('Error syncing calendar:', error);
    
    // Handle validation errors
    if (error instanceof ZodError) {
      return createErrorResponse(400, 'Validation error', {
        details: error.issues
      });
    }

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while syncing calendar. Please try again later.'
    });
  } finally {
    // Ensure database connection is closed
    await prisma.$disconnect();
  }
};