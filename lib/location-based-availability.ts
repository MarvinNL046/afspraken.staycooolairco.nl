import { format, addMinutes, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns'

interface Location {
  lat: number
  lng: number
  address: string
  postalCode: string
}

interface Appointment {
  id: string
  date: Date
  startTime: string
  endTime: string
  location: Location
  duration: number // in minutes
  serviceType: string
}

interface TimeSlot {
  time: string
  available: boolean
  travelTimeFromPrevious?: number
  travelTimeToNext?: number
  efficiency?: number // 0-100 score for route efficiency
}

// Calculate distance between two points using Haversine formula
export function calculateDistance(loc1: Location, loc2: Location): number {
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

// Estimate travel time based on distance (assuming average speed of 40 km/h in urban areas)
export function estimateTravelTime(distance: number): number {
  const avgSpeed = 40 // km/h
  const baseTime = (distance / avgSpeed) * 60 // convert to minutes
  const buffer = 5 // add 5 minutes buffer for parking, etc.
  return Math.ceil(baseTime + buffer)
}

// Check if a new appointment location is efficient given existing appointments
export function calculateRouteEfficiency(
  newLocation: Location,
  existingAppointments: Appointment[],
  date: Date
): number {
  if (existingAppointments.length === 0) return 100

  // Get appointments for the same day
  const sameDayAppointments = existingAppointments.filter(apt => 
    format(apt.date, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
  )

  if (sameDayAppointments.length === 0) return 100

  // Calculate average distance to nearby appointments
  const distances = sameDayAppointments.map(apt => 
    calculateDistance(newLocation, apt.location)
  )
  
  const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length
  
  // Score based on distance (closer is better)
  // Within 5km = 100%, 10km = 80%, 20km = 50%, 30km+ = 20%
  if (avgDistance <= 5) return 100
  if (avgDistance <= 10) return 80
  if (avgDistance <= 20) return 50
  if (avgDistance <= 30) return 30
  return 20
}

// Generate available time slots based on location and existing appointments
export async function generateLocationBasedTimeSlots(
  requestedDate: Date,
  customerLocation: Location,
  existingAppointments: Appointment[],
  serviceDuration: number = 120 // default 2 hours
): Promise<TimeSlot[]> {
  const slots: TimeSlot[] = []
  const dayStart = new Date(requestedDate)
  dayStart.setHours(8, 0, 0, 0)
  const dayEnd = new Date(requestedDate)
  dayEnd.setHours(17, 0, 0, 0)

  // Get appointments for the requested date
  const dayAppointments = existingAppointments
    .filter(apt => format(apt.date, 'yyyy-MM-dd') === format(requestedDate, 'yyyy-MM-dd'))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  // If no appointments yet, offer slots with preference for clustering
  if (dayAppointments.length === 0) {
    // Check nearby days for potential clustering
    const nearbyAppointments = existingAppointments.filter(apt => {
      const daysDiff = Math.abs(apt.date.getTime() - requestedDate.getTime()) / (1000 * 60 * 60 * 24)
      return daysDiff <= 2 // within 2 days
    })

    // If there are nearby appointments, prefer time slots that would create good routes
    let currentTime = dayStart
    while (isBefore(currentTime, dayEnd)) {
      const timeStr = format(currentTime, 'HH:mm')
      const endTime = addMinutes(currentTime, serviceDuration)
      
      if (isBefore(endTime, dayEnd)) {
        const efficiency = calculateRouteEfficiency(customerLocation, nearbyAppointments, requestedDate)
        slots.push({
          time: timeStr,
          available: true,
          efficiency
        })
      }
      
      currentTime = addMinutes(currentTime, 30)
    }
  } else {
    // Find available slots between existing appointments
    let previousAppointment: Appointment | null = null
    
    for (let i = 0; i <= dayAppointments.length; i++) {
      const currentAppointment = dayAppointments[i]
      
      // Check slot before first appointment
      if (i === 0) {
        const firstApptTime = new Date(requestedDate)
        const [hours, minutes] = currentAppointment.startTime.split(':').map(Number)
        firstApptTime.setHours(hours, minutes)
        
        let slotStart = dayStart
        while (isBefore(addMinutes(slotStart, serviceDuration), firstApptTime)) {
          const travelTime = estimateTravelTime(
            calculateDistance(customerLocation, currentAppointment.location)
          )
          
          const slotEnd = addMinutes(slotStart, serviceDuration)
          const timeToNext = Math.floor((firstApptTime.getTime() - slotEnd.getTime()) / (1000 * 60))
          
          if (timeToNext >= travelTime) {
            slots.push({
              time: format(slotStart, 'HH:mm'),
              available: true,
              travelTimeToNext: travelTime,
              efficiency: 100 - (travelTime * 2) // Penalize longer travel times
            })
          }
          
          slotStart = addMinutes(slotStart, 30)
        }
      }
      
      // Check slots between appointments
      if (previousAppointment && currentAppointment) {
        const prevEnd = new Date(requestedDate)
        const [prevEndHours, prevEndMinutes] = previousAppointment.endTime.split(':').map(Number)
        prevEnd.setHours(prevEndHours, prevEndMinutes)
        
        const currStart = new Date(requestedDate)
        const [currStartHours, currStartMinutes] = currentAppointment.startTime.split(':').map(Number)
        currStart.setHours(currStartHours, currStartMinutes)
        
        const travelFromPrev = estimateTravelTime(
          calculateDistance(previousAppointment.location, customerLocation)
        )
        const travelToNext = estimateTravelTime(
          calculateDistance(customerLocation, currentAppointment.location)
        )
        
        let slotStart = addMinutes(prevEnd, travelFromPrev)
        const latestStart = addMinutes(currStart, -serviceDuration - travelToNext)
        
        while (isBefore(slotStart, latestStart)) {
          const slotEnd = addMinutes(slotStart, serviceDuration)
          
          // Check if there's enough time for the appointment plus travel
          if (isBefore(addMinutes(slotEnd, travelToNext), currStart)) {
            // Calculate efficiency based on total travel time
            const totalTravelTime = travelFromPrev + travelToNext
            const efficiency = Math.max(20, 100 - totalTravelTime * 2)
            
            slots.push({
              time: format(slotStart, 'HH:mm'),
              available: true,
              travelTimeFromPrevious: travelFromPrev,
              travelTimeToNext: travelToNext,
              efficiency
            })
          }
          
          slotStart = addMinutes(slotStart, 30)
        }
      }
      
      // Check slot after last appointment
      if (i === dayAppointments.length - 1 && currentAppointment) {
        const lastApptEnd = new Date(requestedDate)
        const [hours, minutes] = currentAppointment.endTime.split(':').map(Number)
        lastApptEnd.setHours(hours, minutes)
        
        const travelTime = estimateTravelTime(
          calculateDistance(currentAppointment.location, customerLocation)
        )
        
        let slotStart = addMinutes(lastApptEnd, travelTime)
        while (isBefore(addMinutes(slotStart, serviceDuration), dayEnd)) {
          slots.push({
            time: format(slotStart, 'HH:mm'),
            available: true,
            travelTimeFromPrevious: travelTime,
            efficiency: 100 - (travelTime * 2)
          })
          
          slotStart = addMinutes(slotStart, 30)
        }
      }
      
      previousAppointment = currentAppointment
    }
  }
  
  // Sort slots by efficiency (prefer slots that create better routes)
  return slots.sort((a, b) => (b.efficiency || 0) - (a.efficiency || 0))
}

// Get recommended time slots based on route optimization
export function getRecommendedSlots(
  slots: TimeSlot[],
  maxRecommendations: number = 3
): TimeSlot[] {
  // Filter for highly efficient slots
  const efficientSlots = slots.filter(slot => (slot.efficiency || 0) >= 70)
  
  // If not enough efficient slots, include moderately efficient ones
  if (efficientSlots.length < maxRecommendations) {
    const moderateSlots = slots.filter(slot => 
      (slot.efficiency || 0) >= 50 && (slot.efficiency || 0) < 70
    )
    efficientSlots.push(...moderateSlots)
  }
  
  // Return top slots up to maxRecommendations
  return efficientSlots.slice(0, maxRecommendations)
}

// Calculate estimated arrival time window
export function calculateArrivalWindow(
  appointmentTime: string,
  travelTimeFromPrevious?: number
): { earliest: string; latest: string } {
  const [hours, minutes] = appointmentTime.split(':').map(Number)
  const baseTime = new Date()
  baseTime.setHours(hours, minutes, 0, 0)
  
  // Account for travel time uncertainty (±20%)
  const variance = travelTimeFromPrevious ? Math.ceil(travelTimeFromPrevious * 0.2) : 15
  
  const earliest = addMinutes(baseTime, -variance)
  const latest = addMinutes(baseTime, variance)
  
  return {
    earliest: format(earliest, 'HH:mm'),
    latest: format(latest, 'HH:mm')
  }
}