'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle, Calendar, Clock, MapPin, Download, Phone, Mail } from 'lucide-react'

function BookingSuccessContent() {
  const searchParams = useSearchParams()
  const [appointmentDetails, setAppointmentDetails] = useState<any>(null)

  useEffect(() => {
    // In a real app, you'd fetch appointment details from the API
    // For now, we'll use query params or session storage
    const appointmentId = searchParams.get('id')
    if (appointmentId) {
      // Fetch appointment details
      setAppointmentDetails({
        id: appointmentId,
        service: 'installatie',
        date: '2024-01-15',
        time: '14:00',
        customer: {
          firstName: 'Jan',
          lastName: 'Jansen',
          email: 'jan.jansen@email.nl',
          phone: '06-12345678',
          address: 'Hoofdstraat',
          houseNumber: '123',
          postalCode: '6211 AB',
          city: 'Maastricht',
        },
      })
    }
  }, [searchParams])

  const handleDownloadICS = () => {
    // Generate ICS file content
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
BEGIN:VEVENT
SUMMARY:StayCool Airco - ${appointmentDetails?.service || 'Service'}
DTSTART:20240115T140000
DTEND:20240115T160000
LOCATION:${appointmentDetails?.customer?.address} ${appointmentDetails?.customer?.houseNumber}, ${appointmentDetails?.customer?.postalCode} ${appointmentDetails?.customer?.city}
DESCRIPTION:Afspraak voor ${appointmentDetails?.service}. Onze monteur belt u 30 minuten voor aankomst.
END:VEVENT
END:VCALENDAR`

    // Create and download file
    const blob = new Blob([icsContent], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'staycool-afspraak.ics'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Success Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-scale-in">
            <CheckCircle className="w-12 h-12 text-green-600" />
          </div>
          
          <h1 className="text-4xl font-bold text-gray-900 mb-3">
            Afspraak Succesvol Geboekt!
          </h1>
          <p className="text-xl text-gray-600">
            U ontvangt binnen enkele minuten een bevestiging per e-mail
          </p>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Appointment Details */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Afspraak Details
              </h2>
              
              <div className="bg-blue-50 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-800 font-medium mb-1">Afspraaknummer</p>
                <p className="text-2xl font-mono font-bold text-blue-900">
                  {appointmentDetails?.id || 'APT-2024-001'}
                </p>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-start">
                  <Calendar className="w-5 h-5 text-gray-400 mr-3 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Datum</p>
                    <p className="font-medium">Maandag 15 januari 2024</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <Clock className="w-5 h-5 text-gray-400 mr-3 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Tijd</p>
                    <p className="font-medium">14:00 - 16:00 uur</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <MapPin className="w-5 h-5 text-gray-400 mr-3 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Locatie</p>
                    <p className="font-medium">
                      Hoofdstraat 123<br />
                      6211 AB Maastricht
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t">
                <Button 
                  onClick={handleDownloadICS}
                  variant="outline"
                  className="w-full"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Toevoegen aan agenda (.ics)
                </Button>
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Wat kunt u verwachten?
              </h2>
              
              <div className="space-y-4">
                <div className="flex items-start">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-sm font-semibold text-blue-600">1</span>
                  </div>
                  <div className="ml-4">
                    <p className="font-medium text-gray-900">Bevestigingsmail</p>
                    <p className="text-sm text-gray-600 mt-1">
                      U ontvangt direct een e-mail met alle details van uw afspraak
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-sm font-semibold text-blue-600">2</span>
                  </div>
                  <div className="ml-4">
                    <p className="font-medium text-gray-900">Herinnering</p>
                    <p className="text-sm text-gray-600 mt-1">
                      Een dag voor de afspraak sturen we u een herinnering per SMS
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-sm font-semibold text-blue-600">3</span>
                  </div>
                  <div className="ml-4">
                    <p className="font-medium text-gray-900">Contact vooraf</p>
                    <p className="text-sm text-gray-600 mt-1">
                      Onze monteur belt u 30 minuten voor aankomst
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-sm font-semibold text-blue-600">4</span>
                  </div>
                  <div className="ml-4">
                    <p className="font-medium text-gray-900">Service uitvoering</p>
                    <p className="text-sm text-gray-600 mt-1">
                      Professionele installatie door onze gecertificeerde monteur
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Contactgegevens
              </h2>
              
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-600">Voor vragen</p>
                  <a href="tel:0612345678" className="flex items-center text-blue-600 hover:text-blue-700 font-medium mt-1">
                    <Phone className="w-4 h-4 mr-2" />
                    06-12345678
                  </a>
                </div>
                
                <div>
                  <p className="text-sm text-gray-600">E-mail</p>
                  <a href="mailto:info@staycoolairco.nl" className="flex items-center text-blue-600 hover:text-blue-700 font-medium mt-1">
                    <Mail className="w-4 h-4 mr-2" />
                    info@staycoolairco.nl
                  </a>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-yellow-50 border-yellow-200">
              <h3 className="font-semibold text-yellow-900 mb-2">
                Voorbereidingstips
              </h3>
              <ul className="text-sm text-yellow-800 space-y-2">
                <li>• Zorg voor vrije toegang tot de werkplek</li>
                <li>• Houd 2 meter ruimte vrij rond de unit</li>
                <li>• Parkeerplaats voor onze servicebus</li>
                <li>• Aanwezigheid van een volwassene</li>
              </ul>
            </Card>

            <div className="flex flex-col space-y-3">
              <Link href="/">
                <Button variant="outline" className="w-full">
                  Terug naar home
                </Button>
              </Link>
              <Link href="/booking">
                <Button className="w-full">
                  Nieuwe afspraak maken
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BookingSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <BookingSuccessContent />
    </Suspense>
  )
}