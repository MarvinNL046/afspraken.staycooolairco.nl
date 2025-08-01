'use client'

import { useState } from 'react'
import { CheckCircle, Calendar, Clock, MapPin, User, Wrench, Mail, Phone, Building2, Loader2 } from 'lucide-react'
import { useBookingForm } from '../multi-step-form'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { nl } from 'date-fns/locale'

const serviceLabels = {
  installation: 'Installatie',
  maintenance: 'Onderhoud',
  repair: 'Reparatie',
  inspection: 'Inspectie',
}

export function ReviewConfirmStep() {
  const { formData, setCurrentStep } = useBookingForm()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePrevious = () => {
    setCurrentStep(4)
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      // Prepare appointment data
      const appointmentData = {
        serviceType: formData.serviceType,
        description: formData.description,
        scheduledDate: formData.scheduledDate,
        scheduledTime: formData.scheduledTime,
        customer: {
          customerType: formData.customerType,
          firstName: formData.firstName,
          lastName: formData.lastName,
          company: formData.company,
          email: formData.email,
          phone: formData.phone,
          address: `${formData.address} ${formData.houseNumber}${formData.houseNumberExt ? formData.houseNumberExt : ''}`,
          postalCode: formData.postalCode,
          city: formData.city,
          notes: formData.notes,
          latitude: formData.latitude,
          longitude: formData.longitude,
        },
      }

      const response = await fetch('/.netlify/functions/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appointmentData),
      })

      const result = await response.json()

      if (result.success) {
        setIsSuccess(true)
      } else {
        setError(result.message || 'Er ging iets mis bij het maken van de afspraak')
      }
    } catch (err) {
      console.error('Appointment submission error:', err)
      setError('Er ging iets mis. Probeer het later opnieuw.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSuccess) {
    return (
      <div className="text-center py-12">
        <CheckCircle className="mx-auto h-16 w-16 text-green-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Afspraak Bevestigd!
        </h2>
        <p className="text-gray-600 mb-6">
          Uw afspraak is succesvol ingepland. U ontvangt binnen enkele minuten een 
          bevestiging per e-mail op {formData.email}.
        </p>
        
        <div className="bg-gray-50 p-6 rounded-lg max-w-md mx-auto text-left">
          <h3 className="font-semibold text-gray-900 mb-3">Afspraakdetails</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-start">
              <Calendar className="w-4 h-4 text-gray-500 mr-2 mt-0.5" />
              <span>
                {formData.scheduledDate && format(formData.scheduledDate, 'EEEE d MMMM yyyy', { locale: nl })}
              </span>
            </div>
            <div className="flex items-start">
              <Clock className="w-4 h-4 text-gray-500 mr-2 mt-0.5" />
              <span>{formData.scheduledTime}</span>
            </div>
            <div className="flex items-start">
              <MapPin className="w-4 h-4 text-gray-500 mr-2 mt-0.5" />
              <span>
                {formData.address} {formData.houseNumber}{formData.houseNumberExt}, 
                {formData.postalCode} {formData.city}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => window.location.href = '/'}
          className="mt-8 px-6 py-2 bg-primary text-white rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
        >
          Terug naar Home
        </button>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Controleer uw afspraak
      </h2>
      <p className="text-gray-600 mb-8">
        Controleer of alle gegevens kloppen voordat u de afspraak bevestigt
      </p>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-md">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Service details */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
            <Wrench className="w-5 h-5 mr-2" />
            Service details
          </h3>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-500">Type service:</span>{' '}
              <span className="font-medium">{serviceLabels[formData.serviceType]}</span>
            </div>
            {formData.description && (
              <div>
                <span className="text-gray-500">Omschrijving:</span>{' '}
                <span className="font-medium">{formData.description}</span>
              </div>
            )}
          </div>
        </div>

        {/* Date and time */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
            <Calendar className="w-5 h-5 mr-2" />
            Datum en tijd
          </h3>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-500">Datum:</span>{' '}
              <span className="font-medium">
                {formData.scheduledDate && format(formData.scheduledDate, 'EEEE d MMMM yyyy', { locale: nl })}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Tijd:</span>{' '}
              <span className="font-medium">{formData.scheduledTime}</span>
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
            <MapPin className="w-5 h-5 mr-2" />
            Locatie
          </h3>
          <div className="text-sm">
            <p className="font-medium">
              {formData.address} {formData.houseNumber}{formData.houseNumberExt}
            </p>
            <p className="text-gray-600">
              {formData.postalCode} {formData.city}
            </p>
          </div>
        </div>

        {/* Contact details */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
            <User className="w-5 h-5 mr-2" />
            Contactgegevens
          </h3>
          <div className="space-y-2 text-sm">
            {formData.customerType === 'business' && formData.company && (
              <div className="flex items-center">
                <Building2 className="w-4 h-4 text-gray-500 mr-2" />
                <span className="font-medium">{formData.company}</span>
              </div>
            )}
            <div className="flex items-center">
              <User className="w-4 h-4 text-gray-500 mr-2" />
              <span className="font-medium">{formData.firstName} {formData.lastName}</span>
            </div>
            <div className="flex items-center">
              <Mail className="w-4 h-4 text-gray-500 mr-2" />
              <span>{formData.email}</span>
            </div>
            <div className="flex items-center">
              <Phone className="w-4 h-4 text-gray-500 mr-2" />
              <span>{formData.phone}</span>
            </div>
            {formData.notes && (
              <div className="mt-2">
                <span className="text-gray-500">Opmerkingen:</span>{' '}
                <span className="italic">{formData.notes}</span>
              </div>
            )}
          </div>
        </div>

        {/* Terms and conditions */}
        <div className="bg-blue-50 p-4 rounded-lg text-sm">
          <p className="text-blue-800">
            Door op "Afspraak bevestigen" te klikken, gaat u akkoord met onze{' '}
            <a href="/terms" className="underline">algemene voorwaarden</a> en{' '}
            <a href="/privacy" className="underline">privacyverklaring</a>.
          </p>
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <button
          type="button"
          onClick={handlePrevious}
          disabled={isSubmitting}
          className="px-6 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
        >
          Vorige
        </button>
        
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className={cn(
            "px-6 py-2 rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary",
            !isSubmitting
              ? "bg-primary hover:bg-primary/90"
              : "bg-gray-300 cursor-not-allowed"
          )}
        >
          {isSubmitting ? (
            <span className="flex items-center">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Bezig met versturen...
            </span>
          ) : (
            'Afspraak bevestigen'
          )}
        </button>
      </div>
    </div>
  )
}