import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { getCalendarEvents, getSalesTeamCalendarEvents } from '../../lib/google-calendar';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import { format, parseISO } from 'date-fns';

const prisma = new PrismaClient();

/**
 * Test function to verify sales team color filtering
 * Endpoint: /.netlify/functions/test-color-filtering
 * Method: GET
 * Query params: date (YYYY-MM-DD format)
 * 
 * This function helps verify that the color filtering is working correctly
 * by showing both filtered and unfiltered calendar events
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

  // Check for admin API key
  const apiKey = event.headers['x-api-key'];
  const adminApiKey = process.env.ADMIN_API_KEY || 'your-admin-api-key';
  
  if (apiKey !== adminApiKey) {
    return createErrorResponse(401, 'Unauthorized - Admin API key required');
  }

  try {
    const dateParam = event.queryStringParameters?.date || format(new Date(), 'yyyy-MM-dd');
    const testDate = parseISO(dateParam);
    const endDate = new Date(testDate);
    endDate.setDate(endDate.getDate() + 1);

    // Get ALL calendar events (unfiltered)
    const allCalendarEvents = await getCalendarEvents(testDate, endDate);
    
    // Get ONLY sales team calendar events (filtered)
    const salesTeamEvents = await getSalesTeamCalendarEvents(testDate, endDate);

    // Get appointments from database
    const allAppointments = await prisma.afspraak.findMany({
      where: {
        datum: testDate,
        status: {
          notIn: ['geannuleerd', 'niet_verschenen']
        }
      },
      select: {
        id: true,
        tijd: true,
        colorId: true,
        serviceType: true,
        beschrijving: true,
        status: true
      }
    });

    // Filter appointments by color
    const salesTeamAppointments = allAppointments.filter(apt => apt.colorId === '5');
    const otherTeamAppointments = allAppointments.filter(apt => apt.colorId !== '5');

    // Analyze calendar events by color
    const eventsByColor = allCalendarEvents.reduce((acc: any, event: any) => {
      const colorId = event.colorId || 'default';
      if (!acc[colorId]) {
        acc[colorId] = {
          count: 0,
          events: []
        };
      }
      acc[colorId].count++;
      acc[colorId].events.push({
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        colorId: event.colorId
      });
      return acc;
    }, {});

    const response = {
      testDate: format(testDate, 'yyyy-MM-dd'),
      summary: {
        totalCalendarEvents: allCalendarEvents.length,
        salesTeamCalendarEvents: salesTeamEvents.length,
        otherTeamCalendarEvents: allCalendarEvents.length - salesTeamEvents.length,
        totalDatabaseAppointments: allAppointments.length,
        salesTeamDatabaseAppointments: salesTeamAppointments.length,
        otherTeamDatabaseAppointments: otherTeamAppointments.length
      },
      calendarEventsByColor: eventsByColor,
      databaseAppointments: {
        salesTeam: salesTeamAppointments,
        otherTeams: otherTeamAppointments
      },
      filteringStatus: {
        isWorkingCorrectly: salesTeamEvents.every((event: any) => event.colorId === '5'),
        message: salesTeamEvents.length === eventsByColor['5']?.count 
          ? '✅ Color filtering is working correctly' 
          : '❌ Color filtering issue detected'
      },
      colorLegend: {
        '1': 'Lavender',
        '2': 'Sage',
        '3': 'Grape',
        '4': 'Flamingo',
        '5': 'Banana (Sales Team)', // Yellow
        '6': 'Tangerine',
        '7': 'Peacock',
        '8': 'Graphite',
        '9': 'Blueberry',
        '10': 'Basil',
        '11': 'Tomato'
      }
    };

    return createResponse(200, response);

  } catch (error) {
    console.error('Color filtering test error:', error);
    return createErrorResponse(500, 'Internal server error');
  } finally {
    await prisma.$disconnect();
  }
};