'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { MapPin, AlertCircle, CheckCircle } from 'lucide-react'
import { useBookingForm } from '../multi-step-form'
import { cn } from '@/lib/utils'
import { useLoadScript, Autocomplete } from '@react-google-maps/api'

const libraries: ("places")[] = ["places"]

interface AddressValidation {
  isValid: boolean
  isInServiceArea: boolean
  message?: string
}

export function AddressInputStep() {
  const { formData, updateFormData, setCanProceed, setCurrentStep } = useBookingForm()
  const [validation, setValidation] = useState<AddressValidation | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
    libraries,
  })

  const handlePlaceSelect = useCallback(() => {
    if (!autocompleteRef.current) return

    const place = autocompleteRef.current.getPlace()
    if (!place.address_components || !place.geometry) return

    // Parse address components
    let streetNumber = ''
    let streetName = ''
    let postalCode = ''
    let city = ''
    let country = ''

    place.address_components.forEach((component) => {
      const types = component.types
      if (types.includes('street_number')) {
        streetNumber = component.long_name
      }
      if (types.includes('route')) {
        streetName = component.long_name
      }
      if (types.includes('postal_code')) {
        postalCode = component.long_name
      }
      if (types.includes('locality')) {
        city = component.long_name
      }
      if (types.includes('country')) {
        country = component.short_name
      }
    })

    // Update form data
    updateFormData({
      address: streetName,
      houseNumber: streetNumber,
      postalCode: postalCode,
      city: city,
      latitude: place.geometry.location?.lat(),
      longitude: place.geometry.location?.lng(),
    })

    // Validate address
    validateAddress({
      postalCode,
      country,
      lat: place.geometry.location?.lat() || 0,
      lng: place.geometry.location?.lng() || 0,
    })
  }, [updateFormData])

  const validateAddress = async (addressData: {
    postalCode: string
    country: string
    lat: number
    lng: number
  }) => {
    setIsValidating(true)
    try {
      // Check if in Netherlands
      if (addressData.country !== 'NL') {
        setValidation({
          isValid: false,
          isInServiceArea: false,
          message: 'We leveren alleen diensten in Nederland',
        })
        setCanProceed(false)
        return
      }

      // Check if postal code is in Limburg range (5800-6999)
      const postalNumber = parseInt(addressData.postalCode)
      if (postalNumber >= 5800 && postalNumber <= 6999) {
        setValidation({
          isValid: true,
          isInServiceArea: true,
          message: 'Adres bevindt zich in ons servicegebied!',
        })
        setCanProceed(true)
      } else {
        setValidation({
          isValid: true,
          isInServiceArea: false,
          message: 'Helaas, dit adres valt buiten ons servicegebied in Limburg',
        })
        setCanProceed(false)
      }
    } catch (error) {
      console.error('Address validation error:', error)
      setValidation({
        isValid: false,
        isInServiceArea: false,
        message: 'Er ging iets mis bij het valideren van het adres',
      })
      setCanProceed(false)
    } finally {
      setIsValidating(false)
    }
  }

  const handleNext = () => {
    if (validation?.isValid && validation.isInServiceArea) {
      setCurrentStep(3)
    }
  }

  const handlePrevious = () => {
    setCurrentStep(1)
  }

  useEffect(() => {
    // Check if we have enough data to proceed
    const hasRequiredData = 
      formData.address && 
      formData.houseNumber && 
      formData.postalCode && 
      formData.city &&
      validation?.isValid &&
      validation?.isInServiceArea

    setCanProceed(!!hasRequiredData)
  }, [formData, validation, setCanProceed])

  if (loadError) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
        <p className="text-gray-700">
          Er ging iets mis bij het laden van de kaart. Probeer het later opnieuw.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Waar moeten we zijn?
      </h2>
      <p className="text-gray-600 mb-8">
        Vul uw adres in zodat we kunnen controleren of u in ons servicegebied valt
      </p>

      <div className="space-y-6">
        {/* Google Places Autocomplete */}
        {isLoaded && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <MapPin className="inline w-4 h-4 mr-1" />
              Begin met typen om uw adres te zoeken
            </label>
            <Autocomplete
              onLoad={(autocomplete) => {
                autocompleteRef.current = autocomplete
                // Restrict to Netherlands
                autocomplete.setComponentRestrictions({ country: 'nl' })
                autocomplete.setFields([
                  'address_components',
                  'geometry',
                  'formatted_address',
                ])
              }}
              onPlaceChanged={handlePlaceSelect}
            >
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary"
                placeholder="Typ uw adres..."
              />
            </Autocomplete>
          </div>
        )}

        {/* Manual address fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-1">
              Straatnaam
            </label>
            <input
              type="text"
              id="address"
              value={formData.address}
              onChange={(e) => updateFormData({ address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary"
              placeholder="Hoofdstraat"
            />
          </div>

          <div>
            <label htmlFor="houseNumber" className="block text-sm font-medium text-gray-700 mb-1">
              Huisnummer
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                id="houseNumber"
                value={formData.houseNumber}
                onChange={(e) => updateFormData({ houseNumber: e.target.value })}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary"
                placeholder="123"
              />
              <input
                type="text"
                value={formData.houseNumberExt || ''}
                onChange={(e) => updateFormData({ houseNumberExt: e.target.value })}
                className="w-20 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary"
                placeholder="A"
              />
            </div>
          </div>

          <div>
            <label htmlFor="postalCode" className="block text-sm font-medium text-gray-700 mb-1">
              Postcode
            </label>
            <input
              type="text"
              id="postalCode"
              value={formData.postalCode}
              onChange={(e) => updateFormData({ postalCode: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary"
              placeholder="6221 AB"
            />
          </div>

          <div>
            <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
              Plaats
            </label>
            <input
              type="text"
              id="city"
              value={formData.city}
              onChange={(e) => updateFormData({ city: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary"
              placeholder="Maastricht"
            />
          </div>
        </div>

        {/* Validation message */}
        {validation && (
          <div className={cn(
            "p-4 rounded-md flex items-start",
            validation.isInServiceArea
              ? "bg-green-50 text-green-800"
              : "bg-amber-50 text-amber-800"
          )}>
            {validation.isInServiceArea ? (
              <CheckCircle className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
            )}
            <p className="text-sm">{validation.message}</p>
          </div>
        )}

        {/* Service area info */}
        <div className="bg-blue-50 p-4 rounded-md">
          <h3 className="text-sm font-semibold text-blue-900 mb-1">
            Ons servicegebied
          </h3>
          <p className="text-sm text-blue-700">
            Wij leveren diensten in de hele provincie Limburg. Dit omvat onder andere 
            Maastricht, Heerlen, Sittard-Geleen, Venlo, Roermond, Weert en alle 
            omliggende gemeenten.
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
          disabled={!validation?.isInServiceArea || isValidating}
          className={cn(
            "px-6 py-2 rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary",
            validation?.isInServiceArea && !isValidating
              ? "bg-primary hover:bg-primary/90"
              : "bg-gray-300 cursor-not-allowed"
          )}
        >
          {isValidating ? 'Valideren...' : 'Volgende'}
        </button>
      </div>
    </div>
  )
}