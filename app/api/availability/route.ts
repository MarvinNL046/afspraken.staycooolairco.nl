import { NextRequest, NextResponse } from 'next/server'
import { format, isWeekend, isBefore, startOfDay, parseISO } from 'date-fns'
import { findAvailableSlots, getTopSlots, formatSlotInfo } from '../../../lib/route-optimization'
import { getCalendarEvents } from '../../../lib/google-calendar'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface LocationData {
  lat: number
  lng: number
  address: string
  postalCode: string
  city: string
  houseNumber: string
  houseNumberExt?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { location, dates, serviceType } = body

    if (!location || !location.lat || !location.lng) {
      return NextResponse.json({
        success: false,
        error: 'Location required',
        message: 'Please provide customer location for availability check',
      }, { status: 400 })
    }

    // Get service duration based on type
    const serviceDurations: Record<string, number> = {
      'installatie': 240, // 4 hours
      'onderhoud': 90,    // 1.5 hours
      'reparatie': 120,   // 2 hours
      'inspectie': 60,    // 1 hour
    }
    const serviceDuration = serviceDurations[serviceType] || 120

    // Fetch appointments from Google Calendar (source of truth)
    const startDate = parseISO(dates[0])
    const endDate = parseISO(dates[dates.length - 1])
    
    // Get calendar events for the date range
    const calendarEvents = await getCalendarEvents(startDate, endDate, '5') // Only yellow (sales team)
    
    // Also get appointments from database to get location data
    const dbAppointments = await prisma.afspraak.findMany({
      where: {
        googleEventId: {
          in: calendarEvents.map(event => event.id).filter((id): id is string => id !== null && id !== undefined),
        },
      },
      include: {
        customer: true,
      },
    })
    
    // Create a map for quick lookup
    const appointmentMap = new Map(dbAppointments.map(apt => [apt.googleEventId, apt]))
    
    // Convert calendar events to our format with location data
    const appointments = calendarEvents.map(event => {
      const dbData = appointmentMap.get(event.id || '')
      
      return {
        id: event.id || '',
        date: new Date(event.start?.dateTime || event.start?.date || ''),
        startTime: format(new Date(event.start?.dateTime || ''), 'HH:mm'),
        endTime: format(new Date(event.end?.dateTime || ''), 'HH:mm'),
        location: dbData ? {
          lat: dbData.customer?.latitude || 0,
          lng: dbData.customer?.longitude || 0,
          address: dbData.customer?.address || '',
          postalCode: dbData.customer?.postalCode || '',
          city: dbData.customer?.city || '',
        } : {
          lat: 0,
          lng: 0,
          address: event.location || '',
          postalCode: '',
          city: '',
        },
        summary: event.summary || '',
        colorId: event.colorId || '',
      }
    })

    // Generate availability for each requested date
    const availability: Record<string, any> = {}
    
    for (const dateStr of dates) {
      const date = parseISO(dateStr)
      
      // Skip weekends
      if (isWeekend(date)) {
        availability[dateStr] = {
          slots: [],
          recommended: [],
          message: 'Geen service in het weekend',
        }
        continue
      }
      
      // Skip past dates
      if (isBefore(date, startOfDay(new Date()))) {
        availability[dateStr] = {
          slots: [],
          recommended: [],
          message: 'Datum ligt in het verleden',
        }
        continue
      }
      
      // Find available slots using route optimization
      const slots = await findAvailableSlots(
        date,
        location,
        serviceDuration,
        appointments
      )
      
      // Get top recommended slots
      const topSlots = getTopSlots(slots, 3)
      
      // Format slots for display
      const formattedSlots = slots.map(slot => {
        const slotInfo = formatSlotInfo(slot)
        return {
          time: slot.startTime,
          endTime: slot.endTime,
          available: true,
          efficiency: slot.efficiency,
          travelTimeFromPrevious: slot.travelTimeBefore,
          travelTimeToNext: slot.travelTimeAfter,
          arrivalWindow: slotInfo.arrivalWindow,
          routeInfo: slotInfo.routeInfo,
          isRecommended: topSlots.some(top => top.startTime === slot.startTime),
        }
      })
      
      // Count existing appointments for the day
      const dayAppointments = appointments.filter(apt =>
        format(apt.date, 'yyyy-MM-dd') === dateStr && apt.colorId === '5'
      ).length
      
      availability[dateStr] = {
        slots: formattedSlots,
        recommended: topSlots.map(s => s.startTime),
        dayEfficiency: formattedSlots.length > 0 
          ? Math.round(formattedSlots.reduce((sum, s) => sum + s.efficiency, 0) / formattedSlots.length)
          : 0,
        appointmentCount: dayAppointments,
        maxAppointments: 5,
        isFull: dayAppointments >= 5,
      }
    }
    
    return NextResponse.json({
      success: true,
      availability,
      location: {
        address: `${location.address} ${location.houseNumber}${location.houseNumberExt || ''}, ${location.postalCode} ${location.city}`,
        isValid: true,
      },
      serviceType,
      serviceDuration,
    })
    
  } catch (error) {
    console.error('Error calculating availability:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
      message: 'An error occurred while calculating availability.',
    }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

