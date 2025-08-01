'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle, Calendar, Clock, MapPin, Phone, Mail, User, AlertCircle } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { nl } from 'date-fns/locale'

function BookingConfirmContent() {
  const router = useRouter()
  const [bookingData, setBookingData] = useState<any>(null)
  const [scheduleData, setScheduleData] = useState<any>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Get booking data from sessionStorage
    const booking = sessionStorage.getItem('bookingData')
    const schedule = sessionStorage.getItem('bookingSchedule')
    
    if (!booking || !schedule) {
      router.push('/booking')
      return
    }
    
    setBookingData(JSON.parse(booking))
    setScheduleData(JSON.parse(schedule))
  }, [router])

  const handleConfirm = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/appointments/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          service: bookingData.service,
          customer: {
            firstName: bookingData.firstName,
            lastName: bookingData.lastName,
            email: bookingData.email,
            phone: bookingData.phone,
            address: bookingData.address,
            houseNumber: bookingData.houseNumber,
            houseNumberExt: bookingData.houseNumberExt,
            postalCode: bookingData.postalCode,
            city: bookingData.city,
          },
          notes: bookingData.notes,
          date: scheduleData.date,
          time: scheduleData.time,
        }),
      })

      if (!response.ok) {
        throw new Error('Er ging iets mis bij het maken van de afspraak')
      }

      setIsConfirmed(true)
      
      // Clear session storage
      sessionStorage.removeItem('bookingData')
      sessionStorage.removeItem('bookingSchedule')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isConfirmed) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <Card className="p-8 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-12 h-12 text-green-600" />
          </div>
          
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Afspraak bevestigd!
          </h1>
          <p className="text-lg text-gray-600 mb-8">
            Uw afspraak is succesvol ingepland. U ontvangt binnen enkele minuten een bevestiging per e-mail.
          </p>
          
          <div className="bg-gray-50 rounded-lg p-6 mb-8 text-left">
            <h2 className="font-semibold text-gray-900 mb-3">Wat kunt u verwachten?</h2>
            <ul className="space-y-2 text-gray-600">
              <li className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>U ontvangt een bevestigingsmail met alle details</span>
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Een dag voor de afspraak krijgt u een herinnering</span>
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Onze monteur belt u 30 minuten voor aankomst</span>
              </li>
            </ul>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              onClick={() => router.push('/')}
              variant="outline"
            >
              Terug naar home
            </Button>
            <Button
              onClick={() => router.push('/booking')}
            >
              Nieuwe afspraak maken
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  if (!bookingData || !scheduleData) {
    return <div>Loading...</div>
  }

  const appointmentDate = parseISO(scheduleData.date)

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
            <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
              ✓
            </div>
            <span className="ml-2 text-sm font-medium text-gray-900">Datum & Tijd</span>
          </div>
          <div className="w-24 h-1 bg-gray-200 mx-2"></div>
          <div className="flex items-center">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
              4
            </div>
            <span className="ml-2 text-sm font-medium text-gray-900">Bevestiging</span>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Controleer uw afspraak
        </h1>
        <p className="text-lg text-gray-600">
          Controleer alle gegevens en bevestig uw afspraak
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start">
          <AlertCircle className="w-5 h-5 text-red-600 mr-2 flex-shrink-0 mt-0.5" />
          <p className="text-red-800">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Details */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Afspraak details
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-start">
                <Calendar className="w-5 h-5 text-gray-400 mr-3 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-600">Datum</p>
                  <p className="font-medium">
                    {format(appointmentDate, 'EEEE d MMMM yyyy', { locale: nl })}
                  </p>
                </div>
              </div>
              
              <div className="flex items-start">
                <Clock className="w-5 h-5 text-gray-400 mr-3 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-600">Tijd</p>
                  <p className="font-medium">{scheduleData.time} uur</p>
                </div>
              </div>
              
              <div className="flex items-start">
                <div className="w-5 h-5 text-gray-400 mr-3 mt-0.5 flex items-center justify-center">
                  <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Service</p>
                  <p className="font-medium capitalize">{bookingData.service}</p>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Klantgegevens
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-start">
                <User className="w-5 h-5 text-gray-400 mr-3 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-600">Naam</p>
                  <p className="font-medium">{bookingData.firstName} {bookingData.lastName}</p>
                </div>
              </div>
              
              <div className="flex items-start">
                <Mail className="w-5 h-5 text-gray-400 mr-3 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-600">E-mail</p>
                  <p className="font-medium">{bookingData.email}</p>
                </div>
              </div>
              
              <div className="flex items-start">
                <Phone className="w-5 h-5 text-gray-400 mr-3 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-600">Telefoon</p>
                  <p className="font-medium">{bookingData.phone}</p>
                </div>
              </div>
              
              <div className="flex items-start">
                <MapPin className="w-5 h-5 text-gray-400 mr-3 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-600">Adres</p>
                  <p className="font-medium">
                    {bookingData.address} {bookingData.houseNumber}{bookingData.houseNumberExt}<br />
                    {bookingData.postalCode} {bookingData.city}
                  </p>
                </div>
              </div>
              
              {bookingData.notes && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-gray-600 mb-1">Aanvullende informatie</p>
                  <p className="text-gray-900">{bookingData.notes}</p>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Summary */}
        <div>
          <Card className="p-6 sticky top-24">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Belangrijke informatie
            </h2>
            
            <div className="space-y-4 text-sm">
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-blue-800">
                  <strong>Bevestiging:</strong> U ontvangt direct een bevestiging per e-mail
                </p>
              </div>
              
              <div className="p-3 bg-yellow-50 rounded-lg">
                <p className="text-yellow-800">
                  <strong>Voorbereiding:</strong> Zorg dat de werkplek toegankelijk is
                </p>
              </div>
              
              <div className="p-3 bg-green-50 rounded-lg">
                <p className="text-green-800">
                  <strong>Contact:</strong> Onze monteur belt u 30 minuten voor aankomst
                </p>
              </div>
            </div>

            <div className="mt-6">
              <Button
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="w-full"
                size="lg"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Bevestigen...
                  </span>
                ) : (
                  'Afspraak bevestigen'
                )}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between mt-8">
        <Button
          variant="outline"
          onClick={() => router.push('/booking/schedule')}
          disabled={isSubmitting}
          className="flex items-center space-x-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Vorige</span>
        </Button>
      </div>
    </div>
  )
}

export default function BookingConfirmPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BookingConfirmContent />
    </Suspense>
  )
}