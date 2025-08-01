'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, addDays, startOfWeek, endOfWeek, isSameDay, isToday, isBefore, startOfDay } from 'date-fns'
import { nl } from 'date-fns/locale'

const timeSlots = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
]

function BookingScheduleContent() {
  const router = useRouter()
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [currentWeek, setCurrentWeek] = useState(new Date())
  const [availableSlots, setAvailableSlots] = useState<Record<string, { 
    slots: Array<{ 
      time: string; 
      isRecommended: boolean; 
      efficiency?: number;
      arrivalWindow?: { earliest: string; latest: string };
      travelTimeFromPrevious?: number;
      travelTimeToNext?: number;
    }>; 
    recommended: string[]; 
    dayEfficiency?: number 
  }>>({})
  const [loading, setLoading] = useState(false)
  const [bookingData, setBookingData] = useState<any>(null)

  useEffect(() => {
    // Get booking data from sessionStorage
    const data = sessionStorage.getItem('bookingData')
    if (!data) {
      router.push('/booking')
      return
    }
    setBookingData(JSON.parse(data))
  }, [router])

  useEffect(() => {
    // Fetch available slots for the current week
    if (bookingData) {
      fetchAvailableSlots()
    }
  }, [currentWeek, bookingData])

  const fetchAvailableSlots = async () => {
    if (!bookingData) return
    
    setLoading(true)
    const start = startOfWeek(currentWeek, { weekStartsOn: 1 })
    const end = endOfWeek(currentWeek, { weekStartsOn: 1 })
    
    // Generate date array for the week
    const dates = []
    let current = start
    while (current <= end) {
      dates.push(format(current, 'yyyy-MM-dd'))
      current = addDays(current, 1)
    }
    
    try {
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          location: {
            lat: bookingData.lat || 51.1642, // Default to Maastricht if not geocoded
            lng: bookingData.lng || 5.8458,
            address: bookingData.address,
            postalCode: bookingData.postalCode,
            city: bookingData.city,
            houseNumber: bookingData.houseNumber,
            houseNumberExt: bookingData.houseNumberExt,
          },
          dates,
          serviceType: bookingData.service,
        }),
      })
      
      const data = await response.json()
      
      if (data.success) {
        setAvailableSlots(data.availability)
      } else {
        console.error('Failed to fetch availability:', data.error)
      }
    } catch (error) {
      console.error('Error fetching availability:', error)
    } finally {
      setLoading(false)
    }
  }

  const getWeekDays = () => {
    const start = startOfWeek(currentWeek, { weekStartsOn: 1 })
    const days = []
    
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i)
      days.push(day)
    }
    
    return days
  }

  const handleDateSelect = (date: Date) => {
    if (!isBefore(date, startOfDay(new Date()))) {
      setSelectedDate(date)
      setSelectedTime(null)
    }
  }

  const handleContinue = () => {
    if (selectedDate && selectedTime) {
      sessionStorage.setItem('bookingSchedule', JSON.stringify({
        date: format(selectedDate, 'yyyy-MM-dd'),
        time: selectedTime
      }))
      router.push('/booking/confirm')
    }
  }

  const weekDays = getWeekDays()
  const dateKey = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''
  const dayData = dateKey ? availableSlots[dateKey] : null
  const daySlots = dayData?.slots || []
  const recommendedTimes = dayData?.recommended || []

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Progress Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-center space-x-2">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
              ✓
            </div>
            <span className="ml-2 text-sm font-medium text-gray-900">Service kiezen</span>
          </div>
          <div className="w-24 h-1 bg-gray-200 mx-2"></div>
          <div className="flex items-center">
            <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
              ✓
            </div>
            <span className="ml-2 text-sm font-medium text-gray-900">Gegevens</span>
          </div>
          <div className="w-24 h-1 bg-gray-200 mx-2"></div>
          <div className="flex items-center">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
              3
            </div>
            <span className="ml-2 text-sm font-medium text-gray-900">Datum & Tijd</span>
          </div>
          <div className="w-24 h-1 bg-gray-200 mx-2"></div>
          <div className="flex items-center">
            <div className="w-8 h-8 bg-gray-200 text-gray-500 rounded-full flex items-center justify-center text-sm font-semibold">
              4
            </div>
            <span className="ml-2 text-sm text-gray-500">Bevestiging</span>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Kies datum en tijd
        </h1>
        <p className="text-lg text-gray-600">
          Selecteer een beschikbaar moment voor uw afspraak
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Calendar Section */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Calendar className="w-5 h-5 mr-2 text-blue-600" />
                Selecteer een datum
              </h2>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentWeek(addDays(currentWeek, -7))}
                  className="p-2"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm font-medium px-3">
                  {format(weekDays[0], 'MMM d', { locale: nl })} - {format(weekDays[6], 'MMM d, yyyy', { locale: nl })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentWeek(addDays(currentWeek, 7))}
                  className="p-2"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="h-48 flex items-center justify-center">
                <div className="text-gray-500 flex items-center">
                  <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Beschikbaarheid laden...
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-2">
                {weekDays.map((day, index) => {
                  const dateStr = format(day, 'yyyy-MM-dd')
                  const dayAvailability = availableSlots[dateStr]
                  const slots = dayAvailability?.slots || []
                  const isPast = isBefore(day, startOfDay(new Date()))
                  const isSelected = selectedDate && isSameDay(day, selectedDate)
                  const hasSlots = slots.length > 0
                  const efficiency = dayAvailability?.dayEfficiency || 0
                  
                  return (
                    <div key={index} className="text-center">
                      <div className="text-xs font-medium text-gray-600 mb-1">
                        {format(day, 'EEE', { locale: nl })}
                      </div>
                      <button
                        onClick={() => handleDateSelect(day)}
                        disabled={isPast || !hasSlots}
                        className={`
                          w-full aspect-square rounded-lg font-medium text-sm
                          transition-all duration-200
                          ${isSelected 
                            ? 'bg-blue-600 text-white shadow-lg scale-105' 
                            : isPast
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : !hasSlots
                            ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                            : isToday(day)
                            ? 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
                            : 'bg-white hover:bg-gray-50 border border-gray-200'
                          }
                        `}
                      >
                        <div>{format(day, 'd')}</div>
                        {!isPast && hasSlots && (
                          <div className="text-xs mt-1">
                            {efficiency >= 70 ? '⚡' : efficiency >= 50 ? '✓' : `${slots.length}`}
                          </div>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {selectedDate && (
              <div className="mt-6 pt-6 border-t">
                <h3 className="text-md font-semibold text-gray-900 mb-4 flex items-center">
                  <Clock className="w-4 h-4 mr-2 text-blue-600" />
                  Beschikbare tijden op {format(selectedDate, 'EEEE d MMMM', { locale: nl })}
                </h3>
                
                {daySlots.length > 0 ? (
                  <div>
                    {/* Recommended slots */}
                    {recommendedTimes.length > 0 && (
                      <div className="mb-4">
                        <p className="text-sm font-medium text-gray-700 mb-2">
                          ⚡ Aanbevolen tijden (meest efficiënte route)
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {daySlots
                            .filter(slot => slot.isRecommended)
                            .map((slot) => (
                              <button
                                key={slot.time}
                                onClick={() => setSelectedTime(slot.time)}
                                className={`
                                  relative py-3 px-3 rounded-lg text-sm font-medium
                                  transition-all duration-200
                                  ${selectedTime === slot.time
                                    ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-600 ring-offset-2'
                                    : 'bg-blue-50 hover:bg-blue-100 text-blue-900 border-2 border-blue-200'
                                  }
                                `}
                              >
                                <div className="flex items-center justify-center">
                                  <span className="mr-1">⚡</span>
                                  {slot.time}
                                </div>
                                {slot.arrivalWindow && (
                                  <div className="text-xs mt-1 opacity-75">
                                    {slot.arrivalWindow.earliest} - {slot.arrivalWindow.latest}
                                  </div>
                                )}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                    
                    {/* All slots */}
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Alle beschikbare tijden
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {daySlots.map((slot) => (
                        <button
                          key={slot.time}
                          onClick={() => setSelectedTime(slot.time)}
                          className={`
                            relative py-2 px-3 rounded-lg text-sm font-medium
                            transition-all duration-200
                            ${selectedTime === slot.time
                              ? 'bg-blue-600 text-white shadow-md'
                              : slot.isRecommended
                              ? 'bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200'
                              : 'bg-gray-50 hover:bg-gray-100 text-gray-900 border border-gray-200'
                            }
                          `}
                          title={`Reistijd: ${slot.travelTimeFromPrevious || slot.travelTimeToNext || 0} min`}
                        >
                          {slot.time}
                          {slot.efficiency && slot.efficiency >= 70 && (
                            <span className="absolute -top-1 -right-1 text-xs">⚡</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    Geen beschikbare tijden op deze datum
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Summary Section */}
        <div>
          <Card className="p-6 sticky top-24">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Afspraak overzicht
            </h2>
            
            <div className="space-y-3">
              {bookingData && (
                <>
                  <div>
                    <p className="text-sm text-gray-600">Service</p>
                    <p className="font-medium capitalize">{bookingData.service}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-600">Naam</p>
                    <p className="font-medium">{bookingData.firstName} {bookingData.lastName}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-600">Adres</p>
                    <p className="font-medium">
                      {bookingData.address} {bookingData.houseNumber}{bookingData.houseNumberExt}<br />
                      {bookingData.postalCode} {bookingData.city}
                    </p>
                  </div>
                </>
              )}
              
              {selectedDate && (
                <div className="pt-3 border-t">
                  <p className="text-sm text-gray-600">Datum</p>
                  <p className="font-medium">
                    {format(selectedDate, 'EEEE d MMMM yyyy', { locale: nl })}
                  </p>
                </div>
              )}
              
              {selectedTime && (
                <div>
                  <p className="text-sm text-gray-600">Tijd</p>
                  <p className="font-medium">{selectedTime} uur</p>
                </div>
              )}
            </div>

            <div className="mt-6 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Let op:</strong> U ontvangt een bevestiging per e-mail en SMS
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between mt-8">
        <Button
          variant="outline"
          onClick={() => router.push('/booking/details')}
          className="flex items-center space-x-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Vorige</span>
        </Button>
        
        <Button
          onClick={handleContinue}
          disabled={!selectedDate || !selectedTime}
          className="flex items-center space-x-2"
        >
          <span>Bevestigen</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
    </div>
  )
}

export default function BookingSchedulePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BookingScheduleContent />
    </Suspense>
  )
}