#!/usr/bin/env node

/**
 * Setup Google Credentials
 * 
 * This script creates a credentials file from environment variable
 * to work around AWS Lambda's 4KB environment variable limit
 */

const fs = require('fs');
const path = require('path');

const CREDS_FILE_PATH = path.join(__dirname, '..', '.google-calendar-credentials.json');

function setupGoogleCredentials() {
  console.log('Setting up Google Calendar credentials...');
  
  const credsString = process.env.GOOGLE_CALENDAR_CREDENTIALS;
  
  if (!credsString) {
    console.log('GOOGLE_CALENDAR_CREDENTIALS not found in environment');
    return;
  }
  
  try {
    // Parse to validate JSON
    const creds = JSON.parse(credsString);
    
    // Write to file
    fs.writeFileSync(CREDS_FILE_PATH, JSON.stringify(creds, null, 2));
    console.log('✅ Google Calendar credentials written to file');
    
    // Set a smaller env var to indicate credentials are available
    process.env.GOOGLE_CREDS_AVAILABLE = 'true';
    
  } catch (error) {
    console.error('❌ Failed to setup Google credentials:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  setupGoogleCredentials();
}

module.exports = { setupGoogleCredentials };