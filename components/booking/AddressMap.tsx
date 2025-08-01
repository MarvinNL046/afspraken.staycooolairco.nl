'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Loader } from '@googlemaps/js-api-loader'

interface AddressData {
  address: string
  houseNumber: string
  houseNumberExt: string
  postalCode: string
  city: string
}

interface AddressMapProps {
  address: AddressData
  onValidation: (isValid: boolean, addressData?: any) => void
}

export default function AddressMap({ address, onValidation }: AddressMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [marker, setMarker] = useState<google.maps.Marker | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Limburg province boundary check
  const isInLimburg = useCallback((lat: number, lng: number) => {
    // Simplified boundary check for Limburg province
    // These are approximate boundaries
    const limburgBounds = {
      north: 51.76,
      south: 50.75,
      east: 6.22,
      west: 5.56
    }
    
    return lat >= limburgBounds.south && 
           lat <= limburgBounds.north && 
           lng >= limburgBounds.west && 
           lng <= limburgBounds.east
  }, [])

  const validateAndGeocodeAddress = useCallback(async () => {
    if (!map || !address.postalCode || !address.houseNumber) return

    const fullAddress = `${address.address} ${address.houseNumber}${address.houseNumberExt ? address.houseNumberExt : ''}, ${address.postalCode} ${address.city}, Netherlands`
    
    try {
      const geocoder = new google.maps.Geocoder()
      const results = await geocoder.geocode({ address: fullAddress })
      
      if (results.results && results.results.length > 0) {
        const location = results.results[0].geometry.location
        const lat = location.lat()
        const lng = location.lng()
        
        // Check if in Limburg
        const inLimburg = isInLimburg(lat, lng)
        
        // Update map
        map.setCenter(location)
        map.setZoom(16)
        
        // Update marker
        if (marker) {
          marker.setPosition(location)
        } else {
          const newMarker = new google.maps.Marker({
            position: location,
            map: map,
            title: 'Service locatie',
            animation: google.maps.Animation.DROP,
          })
          setMarker(newMarker)
        }
        
        // Check postal code range for Limburg (5800-6999)
        const postalCodeNum = parseInt(address.postalCode.replace(/\s/g, ''))
        const postalCodeValid = postalCodeNum >= 5800 && postalCodeNum <= 6999
        
        const isValid = inLimburg && postalCodeValid
        
        onValidation(isValid, {
          lat,
          lng,
          formattedAddress: results.results[0].formatted_address,
          street: address.address,
          city: address.city,
          postalCode: address.postalCode,
        })
        
        if (!isValid) {
          setError('Helaas, dit adres ligt buiten ons werkgebied (Limburg)')
        } else {
          setError(null)
        }
      } else {
        onValidation(false)
        setError('Adres niet gevonden')
      }
    } catch (error) {
      console.error('Geocoding error:', error)
      onValidation(false)
      setError('Fout bij het valideren van het adres')
    }
  }, [map, marker, address, isInLimburg, onValidation])

  useEffect(() => {
    const loader = new Loader({
      apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
      version: 'weekly',
      libraries: ['places', 'marker']
    })

    loader.load().then(() => {
      if (mapRef.current && !map) {
        const googleMap = new google.maps.Map(mapRef.current, {
          center: { lat: 51.25, lng: 5.95 }, // Center of Limburg
          zoom: 9,
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          styles: [
            {
              featureType: 'poi',
              elementType: 'labels',
              stylers: [{ visibility: 'off' }]
            }
          ]
        })
        
        // Draw Limburg boundary (simplified)
        const limburgCoords = [
          { lat: 51.76, lng: 5.56 },
          { lat: 51.76, lng: 6.22 },
          { lat: 50.75, lng: 6.22 },
          { lat: 50.75, lng: 5.56 },
        ]
        
        new google.maps.Polygon({
          paths: limburgCoords,
          strokeColor: '#0066CC',
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: '#0066CC',
          fillOpacity: 0.1,
          map: googleMap
        })
        
        setMap(googleMap)
        setIsLoading(false)
      }
    }).catch((error) => {
      console.error('Error loading Google Maps:', error)
      setError('Kaart kon niet geladen worden')
      setIsLoading(false)
    })
  }, [map])

  // Validate address when it changes
  useEffect(() => {
    if (map && address.postalCode && address.houseNumber && address.city) {
      const timeoutId = setTimeout(() => {
        validateAndGeocodeAddress()
      }, 500) // Debounce
      
      return () => clearTimeout(timeoutId)
    }
  }, [map, address, validateAndGeocodeAddress])

  if (isLoading) {
    return (
      <div className="h-64 bg-gray-100 rounded-lg flex items-center justify-center">
        <div className="text-gray-500 flex items-center">
          <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Kaart laden...
        </div>
      </div>
    )
  }

  return (
    <div>
      <div ref={mapRef} className="h-64 rounded-lg overflow-hidden shadow-sm" />
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800 flex items-center">
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </p>
        </div>
      )}
      <div className="mt-3 text-xs text-gray-500">
        <p>Ons werkgebied: Provincie Limburg</p>
      </div>
    </div>
  )
}