// Application constants

// CRITICAL: Sales team configuration
export const SALES_TEAM_CONFIG = {
  // Google Calendar color ID for sales team appointments
  CALENDAR_COLOR_ID: '5', // Yellow
  CALENDAR_COLOR_NAME: 'Yellow',
  TEAM_NAME: 'Limburg Sales Team',
  SERVICE_AREA: 'Limburg',
} as const;

// Business hours configuration
export const BUSINESS_HOURS_CONFIG = {
  START_TIME: '08:00',
  END_TIME: '18:00',
  LUNCH_START: '12:00',
  LUNCH_END: '13:00',
  SLOT_DURATION_MINUTES: 120,
  TIME_ZONE: 'Europe/Amsterdam',
} as const;

// Appointment constraints
export const APPOINTMENT_CONSTRAINTS = {
  MIN_DAYS_AHEAD: 1,
  MAX_DAYS_AHEAD: 60,
  EXCLUDE_WEEKENDS: true,
} as const;

// Service types with their display names
export const SERVICE_TYPES = {
  installation: 'Installatie',
  maintenance: 'Onderhoud',
  repair: 'Reparatie',
  consultation: 'Adviesgesprek',
  installatie: 'Installatie',
  onderhoud: 'Onderhoud',
  reparatie: 'Reparatie',
  consultatie: 'Adviesgesprek',
} as const;

// IMPORTANT: This app manages ONLY sales team appointments
// Other calendar colors are for different teams and must be ignored
export const AVAILABILITY_FILTER_NOTE = `
This appointment system is configured to manage ONLY the sales team appointments.
The sales team uses the YELLOW color (ID: 5) in Google Calendar.
All availability checks, booking validations, and calendar operations
MUST filter by this color to avoid conflicts with other teams.
`;