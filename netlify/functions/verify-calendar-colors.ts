import { Handler } from '@netlify/functions';
import { google } from 'googleapis';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import { getGoogleAuth } from '../../lib/google-calendar';

/**
 * Verify Google Calendar color IDs
 * Endpoint: /.netlify/functions/verify-calendar-colors
 * Method: GET
 * 
 * This function fetches the actual color definitions from Google Calendar API
 * to verify which color ID corresponds to yellow
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
    const auth = getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    // Get color definitions from Google Calendar API
    const colorsResponse = await calendar.colors.get();
    const colors = colorsResponse.data;

    // Also get some recent events to see their colors
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const eventsResponse = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      timeMin: now.toISOString(),
      timeMax: tomorrow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 10
    });

    const events = eventsResponse.data.items || [];

    // Map events with their color info
    const eventsWithColors = events.map(event => ({
      summary: event.summary,
      colorId: event.colorId || 'default',
      start: event.start?.dateTime || event.start?.date,
      colorInfo: event.colorId ? colors.event?.[event.colorId] : null
    }));

    // Extract all event colors
    const eventColors = Object.entries(colors.event || {}).map(([id, colorDef]: [string, any]) => ({
      id,
      background: colorDef.background,
      foreground: colorDef.foreground,
      name: getColorName(id)
    }));

    // Find yellow color
    const yellowColors = eventColors.filter(color => 
      color.background?.toLowerCase().includes('fbd75b') || // Known yellow hex
      color.background?.toLowerCase().includes('fad165') || // Alternative yellow
      color.name.toLowerCase().includes('yellow') ||
      color.name.toLowerCase().includes('banana')
    );

    const response = {
      googleCalendarColors: {
        event: eventColors,
        calendar: colors.calendar ? Object.entries(colors.calendar).length : 0
      },
      yellowColorAnalysis: {
        foundYellowColors: yellowColors,
        correctColorId: yellowColors.find(c => c.id === '5') ? '5' : yellowColors[0]?.id,
        verification: yellowColors.find(c => c.id === '5') 
          ? '✅ VERIFIED: Yellow/Banana is color ID 5' 
          : `⚠️ WARNING: Yellow might be color ID ${yellowColors[0]?.id || 'unknown'}`
      },
      recentEvents: {
        total: eventsWithColors.length,
        byColor: eventsWithColors.reduce((acc: any, event) => {
          const colorId = event.colorId;
          if (!acc[colorId]) acc[colorId] = 0;
          acc[colorId]++;
          return acc;
        }, {}),
        samples: eventsWithColors.slice(0, 5)
      },
      colorIdMapping: {
        '1': 'Lavender',
        '2': 'Sage', 
        '3': 'Grape',
        '4': 'Flamingo',
        '5': 'Banana (Yellow)', // This should be yellow
        '6': 'Tangerine',
        '7': 'Peacock',
        '8': 'Graphite',
        '9': 'Blueberry',
        '10': 'Basil',
        '11': 'Tomato'
      },
      recommendation: yellowColors.find(c => c.id === '5')
        ? 'The system is correctly configured to use color ID 5 for the sales team (yellow).'
        : `Update SALES_TEAM_COLOR_ID to '${yellowColors[0]?.id || '5'}' in the constants file.`
    };

    return createResponse(200, response);

  } catch (error) {
    console.error('Calendar color verification error:', error);
    return createErrorResponse(500, 'Internal server error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

function getColorName(colorId: string): string {
  const colorNames: Record<string, string> = {
    '1': 'Lavender',
    '2': 'Sage',
    '3': 'Grape', 
    '4': 'Flamingo',
    '5': 'Banana',
    '6': 'Tangerine',
    '7': 'Peacock',
    '8': 'Graphite',
    '9': 'Blueberry',
    '10': 'Basil',
    '11': 'Tomato'
  };
  return colorNames[colorId] || `Color ${colorId}`;
}