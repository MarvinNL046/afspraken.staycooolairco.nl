import { Handler } from '@netlify/functions'
import { format, parse, addMinutes, differenceInMinutes, isWeekend } from 'date-fns'
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers'
import { getGoogleAuth } from '../../lib/google-calendar'
import { google } from 'googleapis'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Constants for business rules
const WORK_START_TIME = '09:30'
const WORK_END_TIME = '16:00'
const APPOINTMENT_DURATION = 60 // minutes
const MAX_APPOINTMENTS_PER_DAY = 5
const MAX_RADIUS_KM = 20
const AVERAGE_SPEED_KMH = 50 // Average driving speed in urban areas

interface Location {
  lat: number
  lng: number
  address: string
  postalCode: string
  city: string
}

interface TimeSlot {
  startTime: string
  endTime: string
  drivingTimeBefore: number
  drivingTimeAfter: number
  location: Location
  efficiency: number
  routeInfo: {
    previousStop?: string
    nextStop?: string
    totalDrivingTime: number
    withinRadius: boolean
  }
}

// Calculate distance between two points (Haversine formula)
function calculateDistance(loc1: Location, loc2: Location): number {
  const R = 6371 // Earth's radius in kilometers
  const dLat = (loc2.lat - loc1.lat) * Math.PI / 180
  const dLon = (loc2.lng - loc1.lng) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

// Calculate driving time based on distance
function calculateDrivingTime(distance: number): number {
  const drivingMinutes = Math.ceil((distance / AVERAGE_SPEED_KMH) * 60)
  const parkingBuffer = 5 // 5 minutes for parking and walking
  return drivingMinutes + parkingBuffer
}

// Check if location is within radius from base or any appointment
function isWithinServiceRadius(location: Location, appointments: any[], baseLocation?: Location): boolean {
  // If we have a base location (office), check distance from there
  if (baseLocation) {
    const distanceFromBase = calculateDistance(location, baseLocation)
    if (distanceFromBase <= MAX_RADIUS_KM) return true
  }

  // Check if within radius of any existing appointment
  for (const apt of appointments) {
    if (apt.location) {
      const distance = calculateDistance(location, apt.location)
      if (distance <= MAX_RADIUS_KM) return true
    }
  }

  return appointments.length === 0 // First appointment of the day is always allowed
}

// Calculate route efficiency score
function calculateRouteEfficiency(
  totalDrivingTime: number,
  appointmentCount: number,
  averageDistance: number
): number {
  let efficiency = 100

  // Penalize for excessive driving time (more than 15 min average between appointments)
  const avgDrivingTime = appointmentCount > 0 ? totalDrivingTime / appointmentCount : 0
  if (avgDrivingTime > 15) {
    efficiency -= Math.min(40, Math.floor((avgDrivingTime - 15) / 5) * 10)
  }

  // Penalize for large average distances
  if (averageDistance > 10) {
    efficiency -= Math.min(30, Math.floor((averageDistance - 10) / 5) * 10)
  }

  // Bonus for clustered appointments
  if (averageDistance < 5 && appointmentCount >= 3) {
    efficiency += 20
  }

  return Math.max(0, Math.min(100, efficiency))
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('POST, OPTIONS')
  }

  if (event.httpMethod !== 'POST') {
    return createErrorResponse(405, 'Method not allowed')
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { date, customerLocation, serviceType = 'standaard' } = body

    if (!date || !customerLocation) {
      return createErrorResponse(400, 'Missing required parameters')
    }

    const requestedDate = new Date(date)
    
    // Check if weekend
    if (isWeekend(requestedDate)) {
      return createResponse(200, {
        success: true,
        message: 'Geen service in het weekend',
        availableSlots: [],
      })
    }

    // Get existing appointments from Google Calendar
    const auth = getGoogleAuth()
    const calendar = google.calendar({ version: 'v3', auth })
    
    const dayStart = new Date(requestedDate)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(requestedDate)
    dayEnd.setHours(23, 59, 59, 999)

    const eventsResponse = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    })

    // Filter for yellow (sales team) appointments
    const salesAppointments = (eventsResponse.data.items || [])
      .filter(event => event.colorId === '5')
      .sort((a, b) => {
        const aStart = new Date(a.start?.dateTime || a.start?.date || '')
        const bStart = new Date(b.start?.dateTime || b.start?.date || '')
        return aStart.getTime() - bStart.getTime()
      })

    // Check if day is already full
    if (salesAppointments.length >= MAX_APPOINTMENTS_PER_DAY) {
      return createResponse(200, {
        success: true,
        message: `Dag is vol (${MAX_APPOINTMENTS_PER_DAY} afspraken)`,
        availableSlots: [],
        dayInfo: {
          appointmentCount: salesAppointments.length,
          maxAppointments: MAX_APPOINTMENTS_PER_DAY,
        },
      })
    }

    // Get location data for existing appointments from database
    const eventIds = salesAppointments.map(e => e.id).filter(Boolean)
    const dbAppointments = await prisma.afspraak.findMany({
      where: {
        googleEventId: { in: eventIds as string[] },
      },
      include: { customer: true },
    })

    const appointmentMap = new Map(dbAppointments.map(apt => [apt.googleEventId, apt]))

    // Build appointment list with locations
    const appointmentsWithLocations = salesAppointments.map(event => {
      const dbData = appointmentMap.get(event.id!)
      const startTime = new Date(event.start?.dateTime || event.start?.date || '')
      const endTime = new Date(event.end?.dateTime || event.end?.date || '')
      
      return {
        id: event.id,
        startTime: format(startTime, 'HH:mm'),
        endTime: format(endTime, 'HH:mm'),
        location: dbData?.customer ? {
          lat: dbData.customer.latitude || 0,
          lng: dbData.customer.longitude || 0,
          address: dbData.customer.address,
          postalCode: dbData.customer.postalCode || '',
          city: dbData.customer.city || '',
        } : null,
      }
    }).filter(apt => apt.location)

    // Check if customer location is within service radius
    const withinRadius = isWithinServiceRadius(customerLocation, appointmentsWithLocations)
    if (!withinRadius) {
      return createResponse(200, {
        success: true,
        message: `Locatie buiten servicegebied (>${MAX_RADIUS_KM}km van bestaande routes)`,
        availableSlots: [],
      })
    }

    // Find available time slots
    const availableSlots: TimeSlot[] = []
    const workStart = parse(WORK_START_TIME, 'HH:mm', requestedDate)
    const workEnd = parse(WORK_END_TIME, 'HH:mm', requestedDate)

    // Helper to check if time slot is available
    const isSlotAvailable = (slotStart: Date, slotEnd: Date): boolean => {
      for (const apt of salesAppointments) {
        const aptStart = new Date(apt.start?.dateTime || apt.start?.date || '')
        const aptEnd = new Date(apt.end?.dateTime || apt.end?.date || '')
        
        // Check for overlap
        if (slotStart < aptEnd && slotEnd > aptStart) {
          return false
        }
      }
      return true
    }

    // Try to find slots between appointments
    for (let i = 0; i <= appointmentsWithLocations.length; i++) {
      const prevApt = i > 0 ? appointmentsWithLocations[i - 1] : null
      const nextApt = i < appointmentsWithLocations.length ? appointmentsWithLocations[i] : null

      let earliestStart: Date
      let latestEnd: Date
      let drivingTimeBefore = 0
      let drivingTimeAfter = 0
      let previousStop = ''
      let nextStop = ''

      if (!prevApt && !nextApt) {
        // No appointments yet - full day available
        earliestStart = workStart
        latestEnd = workEnd
      } else if (!prevApt) {
        // Before first appointment
        earliestStart = workStart
        const nextStart = parse(nextApt!.startTime, 'HH:mm', requestedDate)
        
        if (nextApt!.location && customerLocation) {
          const distance = calculateDistance(customerLocation, nextApt!.location)
          drivingTimeAfter = calculateDrivingTime(distance)
          nextStop = nextApt!.location.city
        }
        
        latestEnd = addMinutes(nextStart, -drivingTimeAfter)
      } else if (!nextApt) {
        // After last appointment
        const prevEnd = parse(prevApt.endTime, 'HH:mm', requestedDate)
        
        if (prevApt.location && customerLocation) {
          const distance = calculateDistance(prevApt.location, customerLocation)
          drivingTimeBefore = calculateDrivingTime(distance)
          previousStop = prevApt.location.city
        }
        
        earliestStart = addMinutes(prevEnd, drivingTimeBefore)
        latestEnd = workEnd
      } else {
        // Between two appointments
        const prevEnd = parse(prevApt.endTime, 'HH:mm', requestedDate)
        const nextStart = parse(nextApt.startTime, 'HH:mm', requestedDate)
        
        if (prevApt.location && customerLocation) {
          const distance = calculateDistance(prevApt.location, customerLocation)
          drivingTimeBefore = calculateDrivingTime(distance)
          previousStop = prevApt.location.city
        }
        
        if (nextApt.location && customerLocation) {
          const distance = calculateDistance(customerLocation, nextApt.location)
          drivingTimeAfter = calculateDrivingTime(distance)
          nextStop = nextApt.location.city
        }
        
        earliestStart = addMinutes(prevEnd, drivingTimeBefore)
        latestEnd = addMinutes(nextStart, -drivingTimeAfter)
      }

      // Check if there's enough time for appointment + driving
      const totalRequiredTime = APPOINTMENT_DURATION + (i > 0 ? drivingTimeBefore : 0) + (i < appointmentsWithLocations.length ? drivingTimeAfter : 0)
      const availableTime = differenceInMinutes(latestEnd, earliestStart)
      
      if (availableTime >= APPOINTMENT_DURATION) {
        // Generate possible start times
        let slotStart = earliestStart
        while (differenceInMinutes(latestEnd, slotStart) >= APPOINTMENT_DURATION) {
          const slotEnd = addMinutes(slotStart, APPOINTMENT_DURATION)
          
          if (isSlotAvailable(slotStart, slotEnd)) {
            // Calculate efficiency
            const totalDrivingTime = drivingTimeBefore + drivingTimeAfter
            const efficiency = 100 - Math.min(50, totalDrivingTime * 2) // Lose 2% per minute of driving
            
            availableSlots.push({
              startTime: format(slotStart, 'HH:mm'),
              endTime: format(slotEnd, 'HH:mm'),
              drivingTimeBefore,
              drivingTimeAfter,
              location: customerLocation,
              efficiency: Math.max(0, efficiency),
              routeInfo: {
                previousStop: previousStop || undefined,
                nextStop: nextStop || undefined,
                totalDrivingTime,
                withinRadius: true,
              },
            })
          }
          
          slotStart = addMinutes(slotStart, 30) // Check every 30 minutes
        }
      }
    }

    // Sort by efficiency
    availableSlots.sort((a, b) => b.efficiency - a.efficiency)

    // Calculate day efficiency
    const totalDistance = appointmentsWithLocations.reduce((sum, apt, i) => {
      if (i === 0) return 0
      const prev = appointmentsWithLocations[i - 1]
      if (prev.location && apt.location) {
        return sum + calculateDistance(prev.location, apt.location)
      }
      return sum
    }, 0)

    const dayEfficiency = calculateRouteEfficiency(
      availableSlots.reduce((sum, slot) => sum + slot.routeInfo.totalDrivingTime, 0),
      appointmentsWithLocations.length,
      appointmentsWithLocations.length > 0 ? totalDistance / appointmentsWithLocations.length : 0
    )

    return createResponse(200, {
      success: true,
      availableSlots: availableSlots.slice(0, 10), // Return top 10 slots
      dayInfo: {
        date: format(requestedDate, 'yyyy-MM-dd'),
        appointmentCount: salesAppointments.length,
        maxAppointments: MAX_APPOINTMENTS_PER_DAY,
        slotsRemaining: MAX_APPOINTMENTS_PER_DAY - salesAppointments.length,
        dayEfficiency,
        workingHours: {
          start: WORK_START_TIME,
          end: WORK_END_TIME,
        },
      },
      recommendedSlots: availableSlots
        .filter(slot => slot.efficiency >= 70)
        .slice(0, 3)
        .map(slot => ({
          time: slot.startTime,
          reason: slot.efficiency >= 90 
            ? 'Uitstekende route efficiency'
            : slot.efficiency >= 80 
            ? 'Zeer goede route efficiency'
            : 'Goede route efficiency',
        })),
    })

  } catch (error) {
    console.error('Route optimization error:', error)
    return createErrorResponse(500, 'Internal server error')
  } finally {
    await prisma.$disconnect()
  }
}