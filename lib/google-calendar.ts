import { google } from 'googleapis'
import { GoogleAuth } from 'google-auth-library'
import type { AfspraakWithLead, ServiceType } from './types'
import * as fs from 'fs'
import * as path from 'path'

// Cache the auth instance
let cachedAuth: GoogleAuth | null = null

export function getGoogleAuth(): GoogleAuth {
  if (cachedAuth) {
    return cachedAuth
  }

  let credentials
  
  // First try to load from file (created during build)
  const credsFilePath = path.join(process.cwd(), '.google-calendar-credentials.json')
  if (fs.existsSync(credsFilePath)) {
    try {
      credentials = JSON.parse(fs.readFileSync(credsFilePath, 'utf-8'))
    } catch (error) {
      console.error('Failed to read credentials file:', error)
    }
  }
  
  // Fallback to environment variables
  if (!credentials) {
    const serviceAccountKey = process.env.GOOGLE_CALENDAR_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    if (!serviceAccountKey) {
      throw new Error('Google Calendar credentials not found. Set GOOGLE_CALENDAR_CREDENTIALS environment variable.')
    }

    try {
      credentials = JSON.parse(serviceAccountKey)
    } catch (error) {
      throw new Error('Invalid Google Calendar credentials: Must be valid JSON')
    }
  }

  cachedAuth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar']
  })

  return cachedAuth
}

export async function createCalendarEvent(appointment: AfspraakWithLead) {
  try {
    const auth = getGoogleAuth()
    const calendar = google.calendar({ version: 'v3', auth })

    const startDateTime = new Date(appointment.datum)
    const [hours, minutes] = appointment.tijd.split(':').map(Number)
    startDateTime.setHours(hours, minutes, 0, 0)

    const endDateTime = new Date(startDateTime)
    endDateTime.setMinutes(endDateTime.getMinutes() + appointment.duur)

    const serviceTypeText = getServiceTypeText(appointment.serviceType)
    const customerName = appointment.lead?.naam || `${appointment.customer?.firstName} ${appointment.customer?.lastName}` || 'Klant'
    
    const event = {
      summary: `${serviceTypeText} - ${customerName}`,
      description: [
        `Klant: ${customerName}`,
        `Telefoon: ${appointment.lead?.telefoon || appointment.customer?.phone || ''}`,
        `Email: ${appointment.lead?.email || appointment.customer?.email || ''}`,
        `Type: ${(appointment.lead?.klantType === 'zakelijk' || appointment.customer?.customerType === 'zakelijk') ? 'Zakelijk' : 'Particulier'}`,
        appointment.lead?.bedrijfsnaam || appointment.customer?.company ? `Bedrijf: ${appointment.lead?.bedrijfsnaam || appointment.customer?.company}` : '',
        `\nAdres:`,
        appointment.locatie || appointment.lead?.adres || appointment.customer?.address || '',
        appointment.lead ? `${appointment.lead.postcode} ${appointment.lead.stad}` : appointment.customer ? `${appointment.customer.postalCode} ${appointment.customer.city}` : '',
        appointment.beschrijving ? `\nOmschrijving: ${appointment.beschrijving}` : '',
        appointment.lead?.notities || appointment.customer?.notes ? `\nNotities: ${appointment.lead?.notities || appointment.customer?.notes}` : ''
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Europe/Amsterdam'
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Europe/Amsterdam'
      },
      location: appointment.locatie || (appointment.lead ? `${appointment.lead.adres}, ${appointment.lead.postcode} ${appointment.lead.stad}` : appointment.customer ? `${appointment.customer.address}, ${appointment.customer.postalCode} ${appointment.customer.city}` : ''),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 60 } // 1 hour before
        ]
      },
      colorId: '5' // CRITICAL: Always use yellow (5) for sales team appointments
    }

    const response = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      requestBody: event
    })

    return response.data.id
  } catch (error) {
    console.error('Error creating calendar event:', error)
    throw new Error('Failed to create calendar event')
  }
}

export async function updateCalendarEvent(eventId: string, appointment: AfspraakWithLead) {
  try {
    const auth = getGoogleAuth()
    const calendar = google.calendar({ version: 'v3', auth })

    const startDateTime = new Date(appointment.datum)
    const [hours, minutes] = appointment.tijd.split(':').map(Number)
    startDateTime.setHours(hours, minutes, 0, 0)

    const endDateTime = new Date(startDateTime)
    endDateTime.setMinutes(endDateTime.getMinutes() + appointment.duur)

    const serviceTypeText = getServiceTypeText(appointment.serviceType)
    const customerName = appointment.lead?.naam || `${appointment.customer?.firstName} ${appointment.customer?.lastName}` || 'Klant'

    const event = {
      summary: `${serviceTypeText} - ${customerName}`,
      description: [
        `Klant: ${customerName}`,
        `Telefoon: ${appointment.lead?.telefoon || appointment.customer?.phone || ''}`,
        `Email: ${appointment.lead?.email || appointment.customer?.email || ''}`,
        `Type: ${(appointment.lead?.klantType === 'zakelijk' || appointment.customer?.customerType === 'zakelijk') ? 'Zakelijk' : 'Particulier'}`,
        appointment.lead?.bedrijfsnaam || appointment.customer?.company ? `Bedrijf: ${appointment.lead?.bedrijfsnaam || appointment.customer?.company}` : '',
        `\nAdres:`,
        appointment.locatie || appointment.lead?.adres || appointment.customer?.address || '',
        appointment.lead ? `${appointment.lead.postcode} ${appointment.lead.stad}` : appointment.customer ? `${appointment.customer.postalCode} ${appointment.customer.city}` : '',
        appointment.beschrijving ? `\nOmschrijving: ${appointment.beschrijving}` : '',
        appointment.lead?.notities || appointment.customer?.notes ? `\nNotities: ${appointment.lead?.notities || appointment.customer?.notes}` : ''
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Europe/Amsterdam'
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Europe/Amsterdam'
      },
      location: appointment.locatie || (appointment.lead ? `${appointment.lead.adres}, ${appointment.lead.postcode} ${appointment.lead.stad}` : appointment.customer ? `${appointment.customer.address}, ${appointment.customer.postalCode} ${appointment.customer.city}` : ''),
      colorId: getEventColor(appointment.serviceType)
    }

    await calendar.events.update({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      eventId,
      requestBody: event
    })
  } catch (error) {
    console.error('Error updating calendar event:', error)
    throw new Error('Failed to update calendar event')
  }
}

export async function deleteCalendarEvent(eventId: string) {
  try {
    const auth = getGoogleAuth()
    const calendar = google.calendar({ version: 'v3', auth })

    await calendar.events.delete({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      eventId
    })
  } catch (error) {
    console.error('Error deleting calendar event:', error)
    throw new Error('Failed to delete calendar event')
  }
}

export async function getCalendarEvents(startDate: Date, endDate: Date, colorId?: string) {
  try {
    const auth = getGoogleAuth()
    const calendar = google.calendar({ version: 'v3', auth })

    const response = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    })

    let events = response.data.items || []
    
    // CRITICAL: Filter events by color ID if specified
    // Only return events with the specified color (e.g., yellow/5 for sales team)
    if (colorId) {
      events = events.filter(event => event.colorId === colorId)
    }

    return events
  } catch (error) {
    console.error('Error fetching calendar events:', error)
    return []
  }
}

// New function specifically for sales team availability checking
export async function getSalesTeamCalendarEvents(startDate: Date, endDate: Date) {
  // CRITICAL: Only fetch yellow (ID: 5) appointments for sales team
  const SALES_TEAM_COLOR_ID = '5'
  return getCalendarEvents(startDate, endDate, SALES_TEAM_COLOR_ID)
}

// Helper functions
function getServiceTypeText(serviceType: ServiceType): string {
  const serviceTypes: Record<string, string> = {
    installation: 'Installatie',
    maintenance: 'Onderhoud',
    repair: 'Reparatie',
    consultation: 'Adviesgesprek',
    installatie: 'Installatie',
    onderhoud: 'Onderhoud',
    reparatie: 'Reparatie',
    consultatie: 'Adviesgesprek'
  }
  return serviceTypes[serviceType] || serviceType
}

function getEventColor(serviceType: ServiceType): string {
  const colors: Record<string, string> = {
    installation: '9', // Blue
    maintenance: '10', // Green
    repair: '11', // Red
    consultation: '5', // Yellow
    installatie: '9', // Blue
    onderhoud: '10', // Green
    reparatie: '11', // Red
    consultatie: '5' // Yellow
  }
  return colors[serviceType] || '1'
}