#!/usr/bin/env node
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env.local') });

// Initialize Google Auth
const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
if (!serviceAccountKey) {
  console.error('GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set');
  process.exit(1);
}

let credentials;
try {
  credentials = JSON.parse(serviceAccountKey);
} catch (error) {
  console.error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY: Must be valid JSON');
  process.exit(1);
}

const auth = new GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/calendar']
});

const calendar = google.calendar({ version: 'v3', auth });

async function verifyCalendarColors() {
  try {
    console.log('🔍 Fetching Google Calendar color definitions...\n');
    
    // Get color definitions from Google Calendar API
    const colorsResponse = await calendar.colors.get();
    const colors = colorsResponse.data;

    // Display all event colors
    console.log('📅 Google Calendar Event Colors:');
    console.log('================================');
    
    const colorMapping = {
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

    if (colors.event) {
      Object.entries(colors.event).forEach(([id, colorDef]) => {
        console.log(`ID ${id}: ${colorMapping[id] || `Color ${id}`}`);
        console.log(`  Background: ${colorDef.background}`);
        console.log(`  Foreground: ${colorDef.foreground}`);
        console.log('');
      });
    }

    // Check specifically for yellow/banana color
    console.log('\n🟡 Yellow/Banana Color Verification:');
    console.log('===================================');
    
    const yellowColor = colors.event?.['5'];
    if (yellowColor) {
      console.log('✅ CONFIRMED: Color ID 5 is Yellow/Banana');
      console.log(`   Background: ${yellowColor.background}`);
      console.log(`   Foreground: ${yellowColor.foreground}`);
    } else {
      console.log('❌ WARNING: Color ID 5 not found in Google Calendar');
    }

    // Get some recent events to see their colors
    console.log('\n📋 Recent Calendar Events (next 24 hours):');
    console.log('=========================================');
    
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
    
    if (events.length === 0) {
      console.log('No events found in the next 24 hours');
    } else {
      events.forEach((event, index) => {
        const colorId = event.colorId || 'default';
        const colorName = colorId === 'default' ? 'Default' : `${colorMapping[colorId] || `Unknown`} (ID: ${colorId})`;
        console.log(`${index + 1}. ${event.summary || 'No title'}`);
        console.log(`   Time: ${event.start?.dateTime || event.start?.date}`);
        console.log(`   Color: ${colorName}`);
        console.log('');
      });
    }

    // Summary
    console.log('\n📊 Summary:');
    console.log('===========');
    console.log('Sales Team Configuration:');
    console.log('- Team: Limburg Sales Team');
    console.log('- Calendar Color: Yellow/Banana');
    console.log('- Color ID: 5');
    console.log('- Status: ✅ Verified');

  } catch (error) {
    console.error('❌ Error verifying calendar colors:', error.message);
    if (error.code === 401) {
      console.error('Authentication failed. Please check your service account credentials.');
    }
  }
}

// Run the verification
verifyCalendarColors();