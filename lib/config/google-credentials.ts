/**
 * Google Credentials Configuration
 * 
 * Handles Google service account credentials from environment variable
 */

let cachedCredentials: any = null;

export function getGoogleCalendarCredentials() {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const credentialsString = process.env.GOOGLE_CALENDAR_CREDENTIALS;
  
  if (!credentialsString) {
    throw new Error('GOOGLE_CALENDAR_CREDENTIALS environment variable is not set');
  }

  try {
    // Parse the JSON credentials
    cachedCredentials = JSON.parse(credentialsString);
    return cachedCredentials;
  } catch (error) {
    console.error('Failed to parse GOOGLE_CALENDAR_CREDENTIALS:', error);
    throw new Error('Invalid GOOGLE_CALENDAR_CREDENTIALS format');
  }
}

export function getGoogleServiceAccountEmail(): string {
  const credentials = getGoogleCalendarCredentials();
  return credentials.client_email || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
}

export function getGooglePrivateKey(): string {
  const credentials = getGoogleCalendarCredentials();
  return credentials.private_key || '';
}

export function getGoogleProjectId(): string {
  const credentials = getGoogleCalendarCredentials();
  return credentials.project_id || '';
}