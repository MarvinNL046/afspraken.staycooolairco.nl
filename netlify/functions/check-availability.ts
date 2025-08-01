import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { getAvailableSlots } from '../../lib/availability';
import { parseISO, isValid, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';

const prisma = new PrismaClient();

/**
 * Netlify Function to check appointment availability
 * Endpoint: /.netlify/functions/check-availability
 * Method: GET
 * Query params: date (YYYY-MM-DD format)
 * 
 * Returns available time slots for the specified date with Dutch timezone support
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
    // Extract and validate date parameter
    const dateParam = event.queryStringParameters?.date;
    
    if (!dateParam) {
      return createErrorResponse(400, 'Date parameter is required', {
        message: 'Please provide a date in YYYY-MM-DD format'
      });
    }

    // Parse and validate the date
    const requestedDate = parseISO(dateParam);
    
    if (!isValid(requestedDate)) {
      return createErrorResponse(400, 'Invalid date format', {
        message: 'Please provide a valid date in YYYY-MM-DD format'
      });
    }

    // Convert to Dutch timezone (Europe/Amsterdam)
    const amsterdamDate = toZonedTime(requestedDate, 'Europe/Amsterdam');
    
    // Get available slots using the existing availability module
    const availableSlots = await getAvailableSlots(amsterdamDate);
    
    // Format the response with timezone information
    const response = {
      date: format(amsterdamDate, 'yyyy-MM-dd'),
      timezone: 'Europe/Amsterdam',
      businessHours: {
        start: '08:00',
        end: '18:00',
        lunchBreak: {
          start: '12:00',
          end: '13:00'
        }
      },
      slotDuration: 120, // minutes
      slots: availableSlots.map(slot => ({
        id: slot.id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isAvailable: slot.isAvailable,
        displayTime: `${slot.startTime} - ${slot.endTime}`,
      })),
      totalSlots: availableSlots.length,
      availableSlots: availableSlots.filter(slot => slot.isAvailable).length,
    };

    return createResponse(200, response, {
      'Cache-Control': 'no-cache, no-store, must-revalidate', // Prevent caching of availability
    });

  } catch (error) {
    console.error('Error checking availability:', error);
    
    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while checking availability. Please try again later.'
    });
  } finally {
    // Ensure database connection is closed
    await prisma.$disconnect();
  }
};