'use client'

import { useEffect, useState, useRef } from 'react'
import { GoogleMap, Marker, Polyline, InfoWindow, useLoadScript } from '@react-google-maps/api'
import { format } from 'date-fns'
import { MapPin, Navigation, Clock } from 'lucide-react'

const libraries: ("places" | "drawing" | "geometry")[] = ["places", "geometry"]

interface Appointment {
  id: string
  time: string
  address: string
  lat: number
  lng: number
  status: 'completed' | 'current' | 'upcoming'
}

interface ClusterMapProps {
  appointments: Appointment[]
  customerLocation?: { lat: number; lng: number }
  selectedTimeSlot?: string
  routePath?: google.maps.LatLng[]
}

const mapContainerStyle = {
  width: '100%',
  height: '400px',
}

const defaultCenter = {
  lat: 50.8514, // Limburg center
  lng: 5.6909,
}

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: true,
}

export function ClusterMap({ appointments, customerLocation, selectedTimeSlot, routePath }: ClusterMapProps) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
    libraries,
  })

  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)

  useEffect(() => {
    if (mapRef.current && appointments.length > 0) {
      // Fit map to show all markers
      const bounds = new google.maps.LatLngBounds()
      
      appointments.forEach(apt => {
        bounds.extend({ lat: apt.lat, lng: apt.lng })
      })
      
      if (customerLocation) {
        bounds.extend(customerLocation)
      }
      
      mapRef.current.fitBounds(bounds)
    }
  }, [appointments, customerLocation])

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-100 rounded-lg">
        <p className="text-gray-500">Kaart kon niet worden geladen</p>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-100 rounded-lg">
        <p className="text-gray-500">Kaart wordt geladen...</p>
      </div>
    )
  }

  const getMarkerIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return {
          url: 'data:image/svg+xml;base64,' + btoa(`
            <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="20" r="10" fill="#10b981" stroke="#fff" stroke-width="2"/>
              <path d="M15 20l3 3 6-6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          `),
          scaledSize: new google.maps.Size(40, 40),
        }
      case 'current':
        return {
          url: 'data:image/svg+xml;base64,' + btoa(`
            <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="20" r="10" fill="#3b82f6" stroke="#fff" stroke-width="2">
                <animate attributeName="r" values="10;12;10" dur="1.5s" repeatCount="indefinite"/>
              </circle>
            </svg>
          `),
          scaledSize: new google.maps.Size(40, 40),
        }
      default:
        return {
          url: 'data:image/svg+xml;base64,' + btoa(`
            <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="20" r="10" fill="#6b7280" stroke="#fff" stroke-width="2"/>
            </svg>
          `),
          scaledSize: new google.maps.Size(40, 40),
        }
    }
  }

  const customerIcon = {
    url: 'data:image/svg+xml;base64,' + btoa(`
      <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        <path d="M24 0C15.163 0 8 7.163 8 16c0 12 16 32 16 32s16-20 16-32c0-8.837-7.163-16-16-16zm0 22c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z" fill="#dc2626" stroke="#fff" stroke-width="2"/>
      </svg>
    `),
    scaledSize: new google.maps.Size(48, 48),
    anchor: new google.maps.Point(24, 48),
  }

  return (
    <div className="rounded-lg overflow-hidden shadow-md">
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={customerLocation || defaultCenter}
        zoom={12}
        options={mapOptions}
        onLoad={(map) => { mapRef.current = map }}
      >
        {/* Existing appointments */}
        {appointments.map((appointment) => (
          <Marker
            key={appointment.id}
            position={{ lat: appointment.lat, lng: appointment.lng }}
            icon={getMarkerIcon(appointment.status)}
            onClick={() => setSelectedAppointment(appointment)}
          />
        ))}

        {/* Customer location */}
        {customerLocation && (
          <Marker
            position={customerLocation}
            icon={customerIcon}
            animation={google.maps.Animation.DROP}
          />
        )}

        {/* Route path */}
        {routePath && routePath.length > 0 && (
          <Polyline
            path={routePath}
            options={{
              strokeColor: '#3b82f6',
              strokeOpacity: 0.8,
              strokeWeight: 3,
              geodesic: true,
            }}
          />
        )}

        {/* Info window */}
        {selectedAppointment && (
          <InfoWindow
            position={{ lat: selectedAppointment.lat, lng: selectedAppointment.lng }}
            onCloseClick={() => setSelectedAppointment(null)}
          >
            <div className="p-2">
              <h3 className="font-semibold text-gray-900 mb-1">
                {selectedAppointment.time}
              </h3>
              <p className="text-sm text-gray-600">
                {selectedAppointment.address}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Status: {
                  selectedAppointment.status === 'completed' ? 'Voltooid' :
                  selectedAppointment.status === 'current' ? 'Huidige' : 'Gepland'
                }
              </p>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>

      {/* Legend */}
      <div className="bg-white p-4 border-t">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Legenda</h4>
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex items-center">
            <div className="w-4 h-4 bg-green-500 rounded-full mr-2"></div>
            <span>Voltooid</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 bg-blue-500 rounded-full mr-2"></div>
            <span>Huidige</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 bg-gray-500 rounded-full mr-2"></div>
            <span>Gepland</span>
          </div>
          <div className="flex items-center">
            <MapPin className="w-4 h-4 text-red-600 mr-2" />
            <span>Uw locatie</span>
          </div>
        </div>
      </div>
    </div>
  )
}