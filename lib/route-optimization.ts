import { format, parse, addMinutes, isAfter, isBefore, differenceInMinutes } from 'date-fns'

// Constants
const MAX_APPOINTMENTS_PER_DAY = 5
const WORK_START_HOUR = 8
const WORK_END_HOUR = 17
const DEFAULT_TRAVEL_TIME = 15 // minutes
const BUFFER_TIME = 5 // minutes between appointments

interface Location {
  lat: number
  lng: number
  address: string
  postalCode: string
  city: string
}

interface CalendarEvent {
  id: string
  date: Date
  startTime: string
  endTime: string
  location: Location
  summary: string
  colorId: string
}

interface AvailableSlot {
  date: Date
  startTime: string
  endTime: string
  travelTimeBefore: number
  travelTimeAfter: number
  previousAppointment?: CalendarEvent
  nextAppointment?: CalendarEvent
  efficiency: number
}

// Calculate driving time between two locations using Google Maps Distance Matrix API
export async function calculateDrivingTime(from: Location, to: Location): Promise<number> {
  try {
    // In production, this would call Google Maps Distance Matrix API
    // For now, estimate based on distance
    const distance = calculateDistance(from, to)
    
    // Assume average speed of 50 km/h in urban/suburban areas
    const drivingTime = Math.ceil((distance / 50) * 60)
    
    // Add buffer for parking, walking to door, etc.
    return drivingTime + BUFFER_TIME
  } catch (error) {
    console.error('Error calculating driving time:', error)
    return DEFAULT_TRAVEL_TIME
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

// Find available time slots for a new appointment
export async function findAvailableSlots(
  requestedDate: Date,
  customerLocation: Location,
  serviceDuration: number,
  existingAppointments: CalendarEvent[]
): Promise<AvailableSlot[]> {
  const availableSlots: AvailableSlot[] = []
  
  // Filter appointments for the requested date with yellow color (sales team)
  const dayAppointments = existingAppointments
    .filter(apt => 
      format(apt.date, 'yyyy-MM-dd') === format(requestedDate, 'yyyy-MM-dd') &&
      apt.colorId === '5' // Only yellow appointments
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  // Check if already at max appointments for the day
  if (dayAppointments.length >= MAX_APPOINTMENTS_PER_DAY) {
    return [] // No slots available - day is full
  }

  // Set work day boundaries
  const workStart = new Date(requestedDate)
  workStart.setHours(WORK_START_HOUR, 0, 0, 0)
  const workEnd = new Date(requestedDate)
  workEnd.setHours(WORK_END_HOUR, 0, 0, 0)

  // If no appointments yet, check slots throughout the day
  if (dayAppointments.length === 0) {
    let currentTime = workStart
    while (isBefore(addMinutes(currentTime, serviceDuration), workEnd)) {
      availableSlots.push({
        date: requestedDate,
        startTime: format(currentTime, 'HH:mm'),
        endTime: format(addMinutes(currentTime, serviceDuration), 'HH:mm'),
        travelTimeBefore: 0, // First appointment of the day
        travelTimeAfter: 0,  // No next appointment yet
        efficiency: 100, // First appointment is always efficient
      })
      currentTime = addMinutes(currentTime, 30) // Check every 30 minutes
    }
  } else {
    // Check for slots between existing appointments
    for (let i = 0; i <= dayAppointments.length; i++) {
      const prevAppointment = i > 0 ? dayAppointments[i - 1] : null
      const nextAppointment = i < dayAppointments.length ? dayAppointments[i] : null

      let slotStart: Date
      let slotEnd: Date
      let travelTimeBefore = 0
      let travelTimeAfter = 0

      // Calculate slot boundaries
      if (!prevAppointment) {
        // Slot before first appointment
        slotStart = workStart
        if (nextAppointment) {
          travelTimeAfter = await calculateDrivingTime(customerLocation, nextAppointment.location)
          const nextStart = parse(nextAppointment.startTime, 'HH:mm', requestedDate)
          slotEnd = addMinutes(nextStart, -travelTimeAfter)
        } else {
          slotEnd = workEnd
        }
      } else if (!nextAppointment) {
        // Slot after last appointment
        const prevEnd = parse(prevAppointment.endTime, 'HH:mm', requestedDate)
        travelTimeBefore = await calculateDrivingTime(prevAppointment.location, customerLocation)
        slotStart = addMinutes(prevEnd, travelTimeBefore)
        slotEnd = workEnd
      } else {
        // Slot between two appointments
        const prevEnd = parse(prevAppointment.endTime, 'HH:mm', requestedDate)
        const nextStart = parse(nextAppointment.startTime, 'HH:mm', requestedDate)
        
        travelTimeBefore = await calculateDrivingTime(prevAppointment.location, customerLocation)
        travelTimeAfter = await calculateDrivingTime(customerLocation, nextAppointment.location)
        
        slotStart = addMinutes(prevEnd, travelTimeBefore)
        slotEnd = addMinutes(nextStart, -travelTimeAfter)
      }

      // Check if there's enough time for the appointment
      const availableMinutes = differenceInMinutes(slotEnd, slotStart)
      if (availableMinutes >= serviceDuration) {
        // Generate possible start times within this slot
        let possibleStart = slotStart
        while (isBefore(addMinutes(possibleStart, serviceDuration), slotEnd)) {
          // Calculate efficiency based on total travel time
          const totalTravelTime = travelTimeBefore + travelTimeAfter
          const efficiency = calculateEfficiency(totalTravelTime, prevAppointment, nextAppointment)

          availableSlots.push({
            date: requestedDate,
            startTime: format(possibleStart, 'HH:mm'),
            endTime: format(addMinutes(possibleStart, serviceDuration), 'HH:mm'),
            travelTimeBefore,
            travelTimeAfter,
            previousAppointment: prevAppointment || undefined,
            nextAppointment: nextAppointment || undefined,
            efficiency,
          })

          possibleStart = addMinutes(possibleStart, 15) // Check every 15 minutes
        }
      }
    }
  }

  // Sort by efficiency (best routes first)
  return availableSlots.sort((a, b) => b.efficiency - a.efficiency)
}

// Calculate route efficiency score (0-100)
function calculateEfficiency(
  totalTravelTime: number,
  prevAppointment: CalendarEvent | null,
  nextAppointment: CalendarEvent | null
): number {
  // Base efficiency
  let efficiency = 100

  // Penalize based on travel time
  // Every 10 minutes of travel reduces efficiency by 10%
  efficiency -= Math.min(50, Math.floor(totalTravelTime / 10) * 10)

  // Bonus for consecutive appointments in the same area
  if (prevAppointment && nextAppointment) {
    const prevToNext = calculateDistance(prevAppointment.location, nextAppointment.location)
    if (prevToNext < 5) {
      efficiency += 20 // Bonus for staying in the same area
    }
  }

  // Ensure efficiency is between 0 and 100
  return Math.max(0, Math.min(100, efficiency))
}

// Get recommended slots (top 3 most efficient)
export function getTopSlots(slots: AvailableSlot[], count: number = 3): AvailableSlot[] {
  return slots
    .filter(slot => slot.efficiency >= 50) // Only recommend slots with 50%+ efficiency
    .slice(0, count)
}

// Format slot information for display
export function formatSlotInfo(slot: AvailableSlot): {
  displayTime: string
  arrivalWindow: { start: string; end: string }
  routeInfo: string
} {
  const arrivalVariance = 10 // ±10 minutes variance
  const arrivalTime = parse(slot.startTime, 'HH:mm', new Date())
  
  return {
    displayTime: slot.startTime,
    arrivalWindow: {
      start: format(addMinutes(arrivalTime, -arrivalVariance), 'HH:mm'),
      end: format(addMinutes(arrivalTime, arrivalVariance), 'HH:mm'),
    },
    routeInfo: slot.previousAppointment && slot.nextAppointment
      ? `Tussen ${slot.previousAppointment.location.city} en ${slot.nextAppointment.location.city}`
      : slot.previousAppointment
      ? `Na afspraak in ${slot.previousAppointment.location.city}`
      : slot.nextAppointment
      ? `Voor afspraak in ${slot.nextAppointment.location.city}`
      : 'Eerste afspraak van de dag',
  }
}