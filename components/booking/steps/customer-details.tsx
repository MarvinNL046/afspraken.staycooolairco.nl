'use client'

import { useEffect } from 'react'
import { User, Mail, Phone, Building2, FileText } from 'lucide-react'
import { useBookingForm } from '../multi-step-form'
import { cn } from '@/lib/utils'

export function CustomerDetailsStep() {
  const { formData, updateFormData, setCanProceed, setCurrentStep } = useBookingForm()

  useEffect(() => {
    // Check if all required fields are filled
    const isValid = 
      formData.firstName.trim() !== '' &&
      formData.lastName.trim() !== '' &&
      formData.email.trim() !== '' &&
      formData.phone.trim() !== '' &&
      isValidEmail(formData.email) &&
      isValidPhone(formData.phone)

    setCanProceed(isValid)
  }, [formData, setCanProceed])

  const isValidEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const isValidPhone = (phone: string) => {
    const phoneRegex = /^(\+31|0)[\s-]?[1-9][\s-]?(\d[\s-]?){8}$/
    return phoneRegex.test(phone.replace(/\s/g, ''))
  }

  const handleNext = () => {
    if (formData.firstName && formData.lastName && formData.email && formData.phone) {
      setCurrentStep(5)
    }
  }

  const handlePrevious = () => {
    setCurrentStep(3)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Uw contactgegevens
      </h2>
      <p className="text-gray-600 mb-8">
        Vul uw gegevens in zodat we contact met u kunnen opnemen
      </p>

      <div className="space-y-6">
        {/* Customer type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Type klant
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => updateFormData({ customerType: 'residential' })}
              className={cn(
                "px-4 py-3 rounded-md border-2 text-center transition-all",
                formData.customerType === 'residential'
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-gray-200 hover:border-gray-300"
              )}
            >
              <User className="w-5 h-5 mx-auto mb-1" />
              <span className="text-sm font-medium">Particulier</span>
            </button>
            
            <button
              type="button"
              onClick={() => updateFormData({ customerType: 'business' })}
              className={cn(
                "px-4 py-3 rounded-md border-2 text-center transition-all",
                formData.customerType === 'business'
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-gray-200 hover:border-gray-300"
              )}
            >
              <Building2 className="w-5 h-5 mx-auto mb-1" />
              <span className="text-sm font-medium">Zakelijk</span>
            </button>
          </div>
        </div>

        {/* Company name (only for business) */}
        {formData.customerType === 'business' && (
          <div>
            <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-1">
              <Building2 className="inline w-4 h-4 mr-1" />
              Bedrijfsnaam
            </label>
            <input
              type="text"
              id="company"
              value={formData.company || ''}
              onChange={(e) => updateFormData({ company: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary"
              placeholder="StayCool B.V."
            />
          </div>
        )}

        {/* Name fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
              <User className="inline w-4 h-4 mr-1" />
              Voornaam
            </label>
            <input
              type="text"
              id="firstName"
              value={formData.firstName}
              onChange={(e) => updateFormData({ firstName: e.target.value })}
              className={cn(
                "w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary",
                formData.firstName && "border-gray-300",
                !formData.firstName && "border-gray-300"
              )}
              placeholder="Jan"
              required
            />
          </div>

          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
              Achternaam
            </label>
            <input
              type="text"
              id="lastName"
              value={formData.lastName}
              onChange={(e) => updateFormData({ lastName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary"
              placeholder="Jansen"
              required
            />
          </div>
        </div>

        {/* Contact fields */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            <Mail className="inline w-4 h-4 mr-1" />
            E-mailadres
          </label>
          <input
            type="email"
            id="email"
            value={formData.email}
            onChange={(e) => updateFormData({ email: e.target.value })}
            className={cn(
              "w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary",
              formData.email && !isValidEmail(formData.email) && "border-red-300"
            )}
            placeholder="jan.jansen@example.nl"
            required
          />
          {formData.email && !isValidEmail(formData.email) && (
            <p className="mt-1 text-sm text-red-600">
              Voer een geldig e-mailadres in
            </p>
          )}
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            <Phone className="inline w-4 h-4 mr-1" />
            Telefoonnummer
          </label>
          <input
            type="tel"
            id="phone"
            value={formData.phone}
            onChange={(e) => updateFormData({ phone: e.target.value })}
            className={cn(
              "w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary",
              formData.phone && !isValidPhone(formData.phone) && "border-red-300"
            )}
            placeholder="06-12345678"
            required
          />
          {formData.phone && !isValidPhone(formData.phone) && (
            <p className="mt-1 text-sm text-red-600">
              Voer een geldig telefoonnummer in
            </p>
          )}
        </div>

        {/* Additional notes */}
        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
            <FileText className="inline w-4 h-4 mr-1" />
            Opmerkingen (optioneel)
          </label>
          <textarea
            id="notes"
            rows={3}
            value={formData.notes || ''}
            onChange={(e) => updateFormData({ notes: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary"
            placeholder="Eventuele bijzonderheden..."
          />
        </div>

        {/* Privacy notice */}
        <div className="bg-gray-50 p-4 rounded-md text-sm text-gray-600">
          <p>
            Door uw gegevens in te vullen gaat u akkoord met onze{' '}
            <a href="/privacy" className="text-primary hover:underline">
              privacyverklaring
            </a>
            . Wij gebruiken uw gegevens alleen voor het verwerken van uw afspraak 
            en eventuele follow-up communicatie.
          </p>
        </div>
      </div>

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
          disabled={
            !formData.firstName || 
            !formData.lastName || 
            !formData.email || 
            !formData.phone ||
            !isValidEmail(formData.email) ||
            !isValidPhone(formData.phone)
          }
          className={cn(
            "px-6 py-2 rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary",
            formData.firstName && formData.lastName && formData.email && formData.phone && isValidEmail(formData.email) && isValidPhone(formData.phone)
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