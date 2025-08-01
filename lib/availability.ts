import { prisma } from './prisma'
import { getCalendarEvents, getSalesTeamCalendarEvents } from './google-calendar'
import { addDays, format, isSameDay, isWeekend, startOfDay } from 'date-fns'
import { BUSINESS_HOURS, DATE_CONSTRAINTS } from './types'
import type { TimeSlotWithAvailability } from './types'

// CRITICAL: Sales team color ID for filtering
const SALES_TEAM_COLOR_ID = '5' // Yellow color in Google Calendar

export async function generateTimeSlots(date: Date): Promise<string[]> {
  const slots: string[] = []
  const { start, end, slotDuration, breakTimes } = BUSINESS_HOURS
  
  const [startHour, startMin] = start.split(':').map(Number)
  const [endHour, endMin] = end.split(':').map(Number)
  
  let currentTime = new Date(date)
  currentTime.setHours(startHour, startMin, 0, 0)
  
  const endTime = new Date(date)
  endTime.setHours(endHour, endMin, 0, 0)
  
  while (currentTime < endTime) {
    const timeString = format(currentTime, 'HH:mm')
    
    // Check if this time falls within a break
    const isBreak = breakTimes.some(breakTime => {
      const [breakStartHour, breakStartMin] = breakTime.start.split(':').map(Number)
      const [breakEndHour, breakEndMin] = breakTime.end.split(':').map(Number)
      
      const breakStart = new Date(date)
      breakStart.setHours(breakStartHour, breakStartMin, 0, 0)
      
      const breakEnd = new Date(date)
      breakEnd.setHours(breakEndHour, breakEndMin, 0, 0)
      
      return currentTime >= breakStart && currentTime < breakEnd
    })
    
    if (!isBreak) {
      // Check if there's enough time before the end of the day
      const slotEnd = new Date(currentTime)
      slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration)
      
      if (slotEnd <= endTime) {
        slots.push(timeString)
      }
    }
    
    currentTime.setMinutes(currentTime.getMinutes() + slotDuration)
  }
  
  return slots
}

export async function getAvailableSlots(date: Date): Promise<TimeSlotWithAvailability[]> {
  try {
    // Check if date is valid
    if (isWeekend(date) && DATE_CONSTRAINTS.excludeWeekends) {
      return []
    }
    
    const today = startOfDay(new Date())
    const requestedDate = startOfDay(date)
    const daysDiff = Math.floor((requestedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysDiff < DATE_CONSTRAINTS.minDaysAhead || daysDiff > DATE_CONSTRAINTS.maxDaysAhead) {
      return []
    }
    
    // Check if date is blocked
    const blockedDate = await prisma.blockedDate.findUnique({
      where: { date: requestedDate }
    })
    
    if (blockedDate) {
      return []
    }
    
    // Generate all possible time slots
    const allSlots = await generateTimeSlots(date)
    
    // Get existing time slots from database
    const existingSlots = await prisma.timeSlot.findMany({
      where: { date: requestedDate }
    })
    
    // CRITICAL: Only get sales team appointments (colorId = '5')
    const appointments = await prisma.afspraak.findMany({
      where: {
        datum: requestedDate,
        status: {
          notIn: ['geannuleerd', 'niet_verschenen']
        },
        // ONLY consider yellow appointments for the sales team
        colorId: SALES_TEAM_COLOR_ID
      }
    })
    
    // CRITICAL: Only get sales team calendar events (yellow/5)
    const endDate = new Date(requestedDate)
    endDate.setDate(endDate.getDate() + 1)
    const calendarEvents = await getSalesTeamCalendarEvents(requestedDate, endDate)
    
    // Map slots to availability
    const slotsWithAvailability: TimeSlotWithAvailability[] = []
    
    for (const slotTime of allSlots) {
      const existingSlot = existingSlots.find(s => s.startTime === slotTime)
      
      if (existingSlot) {
        // Use existing slot data
        slotsWithAvailability.push({
          ...existingSlot,
          available: existingSlot.isAvailable && existingSlot.currentBookings < existingSlot.maxAppointments
        })
      } else {
        // Check if slot is taken by appointments or calendar events
        const isBooked = appointments.some(apt => apt.tijd === slotTime)
        
        // Check Google Calendar conflicts
        const hasCalendarConflict = calendarEvents.some(event => {
          if (!event.start?.dateTime) return false
          
          const eventStart = new Date(event.start.dateTime)
          const [slotHour, slotMin] = slotTime.split(':').map(Number)
          const slotStart = new Date(date)
          slotStart.setHours(slotHour, slotMin, 0, 0)
          const slotEnd = new Date(slotStart)
          slotEnd.setMinutes(slotEnd.getMinutes() + BUSINESS_HOURS.slotDuration)
          
          return eventStart < slotEnd && new Date(event.end?.dateTime || '') > slotStart
        })
        
        // Create new slot
        const newSlot = await prisma.timeSlot.create({
          data: {
            date: requestedDate,
            startTime: slotTime,
            endTime: format(
              new Date(date.setHours(
                parseInt(slotTime.split(':')[0]), 
                parseInt(slotTime.split(':')[1]) + BUSINESS_HOURS.slotDuration
              )), 
              'HH:mm'
            ),
            isAvailable: !hasCalendarConflict,
            currentBookings: isBooked ? 1 : 0
          }
        })
        
        slotsWithAvailability.push({
          ...newSlot,
          available: newSlot.isAvailable && newSlot.currentBookings < newSlot.maxAppointments
        })
      }
    }
    
    return slotsWithAvailability
  } catch (error) {
    console.error('Error getting available slots:', error)
    return []
  }
}

export async function getAvailableDates(startDate: Date, numberOfDays: number = 30): Promise<Date[]> {
  const availableDates: Date[] = []
  let currentDate = new Date(startDate)
  let daysChecked = 0
  
  while (availableDates.length < numberOfDays && daysChecked < DATE_CONSTRAINTS.maxDaysAhead) {
    if (!isWeekend(currentDate) || !DATE_CONSTRAINTS.excludeWeekends) {
      const daysDiff = Math.floor((currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
      
      if (daysDiff >= DATE_CONSTRAINTS.minDaysAhead) {
        const blockedDate = await prisma.blockedDate.findUnique({
          where: { date: startOfDay(currentDate) }
        })
        
        if (!blockedDate) {
          // Check if there are any available slots for this date
          const slots = await getAvailableSlots(currentDate)
          if (slots.some(slot => slot.available)) {
            availableDates.push(new Date(currentDate))
          }
        }
      }
    }
    
    currentDate = addDays(currentDate, 1)
    daysChecked++
  }
  
  return availableDates
}

export async function markSlotAsBooked(date: Date, time: string): Promise<void> {
  const dateOnly = startOfDay(date)
  
  await prisma.timeSlot.upsert({
    where: {
      date_startTime: {
        date: dateOnly,
        startTime: time
      }
    },
    update: {
      currentBookings: {
        increment: 1
      }
    },
    create: {
      date: dateOnly,
      startTime: time,
      endTime: format(
        new Date(date.setHours(
          parseInt(time.split(':')[0]), 
          parseInt(time.split(':')[1]) + BUSINESS_HOURS.slotDuration
        )), 
        'HH:mm'
      ),
      currentBookings: 1
    }
  })
}

export async function markSlotAsAvailable(date: Date, time: string): Promise<void> {
  const dateOnly = startOfDay(date)
  
  await prisma.timeSlot.update({
    where: {
      date_startTime: {
        date: dateOnly,
        startTime: time
      }
    },
    data: {
      currentBookings: {
        decrement: 1
      }
    }
  })
}