'use client'

import { useEffect, useState } from 'react'
import { Calendar, Clock, MapPin, TrendingUp, Loader2, Map } from 'lucide-react'
import { useBookingForm } from '../multi-step-form'
import { cn } from '@/lib/utils'
import { format, addDays, isWeekend } from 'date-fns'
import { nl } from 'date-fns/locale'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { ClusterMap } from '../cluster-map'

interface TimeSlot {
  startTime: string
  endTime: string
  efficiency: number
  routeInfo: {
    previousStop?: string
    nextStop?: string
    totalDrivingTime: number
  }
}

interface DayInfo {
  appointmentCount: number
  maxAppointments: number
  slotsRemaining: number
  dayEfficiency: number
}

interface DayAppointment {
  id: string
  time: string
  address: string
  lat: number
  lng: number
  status: 'completed' | 'current' | 'upcoming'
}

export function DateTimeSelectionStep() {
  const { formData, updateFormData, setCanProceed, setCurrentStep } = useBookingForm()
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(formData.scheduledDate)
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([])
  const [recommendedSlots, setRecommendedSlots] = useState<any[]>([])
  const [dayInfo, setDayInfo] = useState<DayInfo | null>(null)
  const [dayAppointments, setDayAppointments] = useState<DayAppointment[]>([])
  const [showMap, setShowMap] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check availability when date changes
  useEffect(() => {
    if (selectedDate && formData.latitude && formData.longitude) {
      checkAvailability(selectedDate)
    }
  }, [selectedDate, formData.latitude, formData.longitude])

  const checkAvailability = async (date: Date) => {
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/.netlify/functions/optimize-daily-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: format(date, 'yyyy-MM-dd'),
          customerLocation: {
            lat: formData.latitude,
            lng: formData.longitude,
            address: formData.address,
            postalCode: formData.postalCode,
            city: formData.city,
          },
          serviceType: formData.serviceType,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to check availability')
      }

      const data = await response.json()
      
      if (data.success) {
        setAvailableSlots(data.availableSlots || [])
        setRecommendedSlots(data.recommendedSlots || [])
        setDayInfo(data.dayInfo)
        
        // Parse existing appointments for map visualization
        if (data.existingAppointments) {
          const appointments: DayAppointment[] = data.existingAppointments.map((apt: any) => ({
            id: apt.id,
            time: apt.time,
            address: apt.address,
            lat: apt.lat,
            lng: apt.lng,
            status: getAppointmentStatus(apt.time),
          }))
          setDayAppointments(appointments)
        }
      } else {
        setError(data.message || 'Er ging iets mis')
        setAvailableSlots([])
        setDayAppointments([])
      }
    } catch (err) {
      console.error('Availability check error:', err)
      setError('Kon beschikbaarheid niet controleren')
      setAvailableSlots([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date)
    updateFormData({ scheduledDate: date })
    if (date) {
      // Reset time selection when date changes
      updateFormData({ scheduledTime: undefined })
    }
  }

  const handleTimeSelect = (time: string) => {
    updateFormData({ scheduledTime: time })
  }

  const handleNext = () => {
    if (formData.scheduledDate && formData.scheduledTime) {
      setCurrentStep(4)
    }
  }

  const handlePrevious = () => {
    setCurrentStep(2)
  }

  useEffect(() => {
    setCanProceed(!!formData.scheduledDate && !!formData.scheduledTime)
  }, [formData.scheduledDate, formData.scheduledTime, setCanProceed])

  // Disable weekends and past dates
  const disabledDays = (date: Date) => {
    return date < new Date() || isWeekend(date)
  }

  // Helper to determine appointment status based on time
  const getAppointmentStatus = (time: string): 'completed' | 'current' | 'upcoming' => {
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()
    const [aptHour, aptMinute] = time.split(':').map(Number)
    
    if (aptHour < currentHour || (aptHour === currentHour && aptMinute < currentMinute)) {
      return 'completed'
    } else if (aptHour === currentHour) {
      return 'current'
    } else {
      return 'upcoming'
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Wanneer kunnen we langskomen?
      </h2>
      <p className="text-gray-600 mb-8">
        Selecteer een datum en tijd die u het beste uitkomt
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Calendar */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2" />
            Selecteer een datum
          </h3>
          
          <CalendarComponent
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            disabled={disabledDays}
            locale={nl}
            className="rounded-md border"
            fromDate={new Date()}
            toDate={addDays(new Date(), 60)}
          />

          {/* Day info */}
          {dayInfo && selectedDate && (
            <div className="mt-4 p-4 bg-blue-50 rounded-md">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">
                Dag informatie
              </h4>
              <div className="space-y-1 text-sm text-blue-700">
                <p>
                  {dayInfo.appointmentCount} van {dayInfo.maxAppointments} afspraken gepland
                </p>
                <p>
                  Route efficiëntie: {dayInfo.dayEfficiency}%
                </p>
                <p>
                  {dayInfo.slotsRemaining} plekken beschikbaar
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Time slots */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Clock className="w-5 h-5 mr-2" />
            Beschikbare tijdslots
          </h3>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 text-red-700 rounded-md">
              {error}
            </div>
          ) : !selectedDate ? (
            <div className="text-gray-500 text-center py-12">
              Selecteer eerst een datum
            </div>
          ) : availableSlots.length === 0 ? (
            <div className="text-gray-500 text-center py-12">
              Geen tijdslots beschikbaar op deze datum
            </div>
          ) : (
            <div className="space-y-3">
              {/* Recommended slots */}
              {recommendedSlots.length > 0 && (
                <div className="mb-4 p-3 bg-green-50 rounded-md">
                  <p className="text-sm font-semibold text-green-800 mb-2">
                    🎯 Aanbevolen tijdslots
                  </p>
                  <div className="space-y-2">
                    {recommendedSlots.map((slot, index) => (
                      <div key={index} className="text-sm text-green-700">
                        <span className="font-medium">{slot.time}</span> - {slot.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All available slots */}
              <div className="grid grid-cols-2 gap-2">
                {availableSlots.map((slot) => {
                  const isSelected = formData.scheduledTime === slot.startTime
                  const isRecommended = recommendedSlots.some(r => r.time === slot.startTime)
                  
                  return (
                    <button
                      key={slot.startTime}
                      type="button"
                      onClick={() => handleTimeSelect(slot.startTime)}
                      className={cn(
                        "relative p-3 rounded-md border-2 text-center transition-all",
                        isSelected
                          ? "border-primary bg-primary/10"
                          : isRecommended
                          ? "border-green-500 bg-green-50 hover:bg-green-100"
                          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      )}
                    >
                      <div className="font-medium text-gray-900">
                        {slot.startTime} - {slot.endTime}
                      </div>
                      
                      {/* Efficiency indicator */}
                      <div className="mt-1 flex items-center justify-center">
                        <TrendingUp className="w-3 h-3 mr-1 text-gray-500" />
                        <span className="text-xs text-gray-500">
                          {slot.efficiency}% efficiënt
                        </span>
                      </div>

                      {/* Route info */}
                      {(slot.routeInfo.previousStop || slot.routeInfo.nextStop) && (
                        <div className="mt-2 text-xs text-gray-600">
                          {slot.routeInfo.previousStop && (
                            <div>Na: {slot.routeInfo.previousStop}</div>
                          )}
                          {slot.routeInfo.nextStop && (
                            <div>Voor: {slot.routeInfo.nextStop}</div>
                          )}
                        </div>
                      )}

                      {isSelected && (
                        <div className="absolute top-2 right-2">
                          <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        </div>
                      )}

                      {isRecommended && !isSelected && (
                        <div className="absolute top-2 right-2">
                          <span className="text-green-600">🎯</span>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Map visualization toggle */}
      {selectedDate && dayAppointments.length > 0 && (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setShowMap(!showMap)}
            className="flex items-center px-4 py-2 text-sm font-medium text-primary border border-primary rounded-md hover:bg-primary/10"
          >
            <Map className="w-4 h-4 mr-2" />
            {showMap ? 'Verberg kaart' : 'Toon route op kaart'}
          </button>
          
          {showMap && (
            <div className="mt-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Route visualisatie voor {format(selectedDate, 'd MMMM yyyy', { locale: nl })}
              </h3>
              <ClusterMap
                appointments={dayAppointments}
                customerLocation={
                  formData.latitude && formData.longitude
                    ? { lat: formData.latitude, lng: formData.longitude }
                    : undefined
                }
                selectedTimeSlot={formData.scheduledTime}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between mt-8">
        <button
          type="button"
          onClick={handlePrevious}
          className="px-6 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
        >
          Vorige
        </button>
        
        <button
          type="button"
          onClick={handleNext}
          disabled={!formData.scheduledDate || !formData.scheduledTime}
          className={cn(
            "px-6 py-2 rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary",
            formData.scheduledDate && formData.scheduledTime
              ? "bg-primary hover:bg-primary/90"
              : "bg-gray-300 cursor-not-allowed"
          )}
        >
          Volgende
        </button>
      </div>
    </div>
  )
}