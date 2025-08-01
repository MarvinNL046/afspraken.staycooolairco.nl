'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MapPin, Phone, Mail, User, Home as HomeIcon } from 'lucide-react'
import dynamic from 'next/dynamic'

// Dynamically import the map component
const AddressMap = dynamic(() => import('@/components/booking/AddressMap'), {
  loading: () => (
    <div className="h-64 bg-gray-100 rounded-lg flex items-center justify-center">
      <div className="text-gray-500">Kaart laden...</div>
    </div>
  ),
  ssr: false
})

type FormData = {
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  postalCode: string
  city: string
  houseNumber: string
  houseNumberExt: string
  notes: string
}

function BookingDetailsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const service = searchParams.get('service')

  const [formData, setFormData] = useState<FormData>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    postalCode: '',
    city: '',
    houseNumber: '',
    houseNumberExt: '',
    notes: '',
  })

  const [errors, setErrors] = useState<Partial<FormData>>({})
  const [addressValidated, setAddressValidated] = useState(false)

  useEffect(() => {
    if (!service) {
      router.push('/booking')
    }
  }, [service, router])

  const validateForm = () => {
    const newErrors: Partial<FormData> = {}

    if (!formData.firstName.trim()) newErrors.firstName = 'Voornaam is verplicht'
    if (!formData.lastName.trim()) newErrors.lastName = 'Achternaam is verplicht'
    if (!formData.email.trim()) newErrors.email = 'E-mail is verplicht'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Ongeldig e-mailadres'
    }
    if (!formData.phone.trim()) newErrors.phone = 'Telefoonnummer is verplicht'
    else if (!/^[\d\s\-\+\(\)]+$/.test(formData.phone)) {
      newErrors.phone = 'Ongeldig telefoonnummer'
    }
    if (!formData.address.trim()) newErrors.address = 'Straatnaam is verplicht'
    if (!formData.houseNumber.trim()) newErrors.houseNumber = 'Huisnummer is verplicht'
    if (!formData.postalCode.trim()) newErrors.postalCode = 'Postcode is verplicht'
    else if (!/^\d{4}\s?[A-Z]{2}$/i.test(formData.postalCode)) {
      newErrors.postalCode = 'Ongeldige postcode (bijv. 1234 AB)'
    }
    if (!formData.city.trim()) newErrors.city = 'Plaats is verplicht'

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleContinue = () => {
    if (validateForm() && addressValidated) {
      // Get stored geocoded data
      const geocodedData = sessionStorage.getItem('geocodedAddress')
      const locationData = geocodedData ? JSON.parse(geocodedData) : {}
      
      // Store form data with coordinates in sessionStorage
      sessionStorage.setItem('bookingData', JSON.stringify({ 
        service, 
        ...formData,
        lat: locationData.lat,
        lng: locationData.lng,
      }))
      router.push('/booking/schedule')
    }
  }

  const handleAddressValidation = (isValid: boolean, addressData?: any) => {
    setAddressValidated(isValid)
    if (isValid && addressData) {
      // Store geocoded data
      sessionStorage.setItem('geocodedAddress', JSON.stringify({
        lat: addressData.lat,
        lng: addressData.lng,
        formattedAddress: addressData.formattedAddress,
      }))
      
      setFormData(prev => ({
        ...prev,
        address: addressData.street || prev.address,
        city: addressData.city || prev.city,
      }))
    }
  }

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
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
              2
            </div>
            <span className="ml-2 text-sm font-medium text-gray-900">Gegevens</span>
          </div>
          <div className="w-24 h-1 bg-gray-200 mx-2"></div>
          <div className="flex items-center">
            <div className="w-8 h-8 bg-gray-200 text-gray-500 rounded-full flex items-center justify-center text-sm font-semibold">
              3
            </div>
            <span className="ml-2 text-sm text-gray-500">Datum & Tijd</span>
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
          Uw gegevens
        </h1>
        <p className="text-lg text-gray-600">
          Vul uw contactgegevens en adres in voor de afspraak
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Form Section */}
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <User className="w-5 h-5 mr-2 text-blue-600" />
              Contactgegevens
            </h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Voornaam *
                  </label>
                  <Input
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className={errors.firstName ? 'border-red-500' : ''}
                    placeholder="Jan"
                  />
                  {errors.firstName && (
                    <p className="text-sm text-red-500 mt-1">{errors.firstName}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Achternaam *
                  </label>
                  <Input
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className={errors.lastName ? 'border-red-500' : ''}
                    placeholder="Jansen"
                  />
                  {errors.lastName && (
                    <p className="text-sm text-red-500 mt-1">{errors.lastName}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Mail className="w-4 h-4 inline mr-1" />
                  E-mailadres *
                </label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className={errors.email ? 'border-red-500' : ''}
                  placeholder="jan.jansen@email.nl"
                />
                {errors.email && (
                  <p className="text-sm text-red-500 mt-1">{errors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Phone className="w-4 h-4 inline mr-1" />
                  Telefoonnummer *
                </label>
                <Input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className={errors.phone ? 'border-red-500' : ''}
                  placeholder="06-12345678"
                />
                {errors.phone && (
                  <p className="text-sm text-red-500 mt-1">{errors.phone}</p>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <HomeIcon className="w-5 h-5 mr-2 text-blue-600" />
              Adresgegevens
            </h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Straatnaam *
                  </label>
                  <Input
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className={errors.address ? 'border-red-500' : ''}
                    placeholder="Hoofdstraat"
                  />
                  {errors.address && (
                    <p className="text-sm text-red-500 mt-1">{errors.address}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nr *
                    </label>
                    <Input
                      value={formData.houseNumber}
                      onChange={(e) => setFormData({ ...formData, houseNumber: e.target.value })}
                      className={errors.houseNumber ? 'border-red-500' : ''}
                      placeholder="123"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Toev.
                    </label>
                    <Input
                      value={formData.houseNumberExt}
                      onChange={(e) => setFormData({ ...formData, houseNumberExt: e.target.value })}
                      placeholder="A"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Postcode *
                  </label>
                  <Input
                    value={formData.postalCode}
                    onChange={(e) => setFormData({ ...formData, postalCode: e.target.value.toUpperCase() })}
                    className={errors.postalCode ? 'border-red-500' : ''}
                    placeholder="1234 AB"
                    maxLength={7}
                  />
                  {errors.postalCode && (
                    <p className="text-sm text-red-500 mt-1">{errors.postalCode}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Plaats *
                  </label>
                  <Input
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className={errors.city ? 'border-red-500' : ''}
                    placeholder="Amsterdam"
                  />
                  {errors.city && (
                    <p className="text-sm text-red-500 mt-1">{errors.city}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Aanvullende informatie
                </label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Bijv. achterom lopen, bel defect, specifieke wensen..."
                  rows={3}
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Map Section */}
        <div>
          <Card className="p-6 sticky top-24">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <MapPin className="w-5 h-5 mr-2 text-blue-600" />
              Locatie controleren
            </h2>
            
            <AddressMap
              address={formData}
              onValidation={handleAddressValidation}
            />

            {addressValidated && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 flex items-center">
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Adres gevonden en binnen ons werkgebied
                </p>
              </div>
            )}

            {!addressValidated && formData.postalCode && formData.houseNumber && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  Vul uw volledige adres in om te controleren of we in uw gebied werken
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between mt-8">
        <Button
          variant="outline"
          onClick={() => router.push('/booking')}
          className="flex items-center space-x-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Vorige</span>
        </Button>
        
        <Button
          onClick={handleContinue}
          disabled={!addressValidated}
          className="flex items-center space-x-2"
        >
          <span>Volgende</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
    </div>
  )
}

export default function BookingDetailsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BookingDetailsContent />
    </Suspense>
  )
}