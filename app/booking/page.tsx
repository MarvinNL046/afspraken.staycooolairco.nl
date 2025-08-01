'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Home, Wrench, Shield, Thermometer } from 'lucide-react'

type ServiceType = 'installatie' | 'onderhoud' | 'reparatie' | 'inspectie'

const services = [
  {
    id: 'installatie' as ServiceType,
    title: 'Nieuwe Installatie',
    description: 'Installatie van een nieuwe airconditioning unit',
    icon: Home,
    duration: '2-4 uur',
    price: 'Vanaf €1.499',
    color: 'bg-blue-500',
    lightColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    hoverColor: 'hover:border-blue-400',
  },
  {
    id: 'onderhoud' as ServiceType,
    title: 'Onderhoud',
    description: 'Periodiek onderhoud voor optimale werking',
    icon: Shield,
    duration: '1-2 uur',
    price: 'Vanaf €89',
    color: 'bg-green-500',
    lightColor: 'bg-green-50',
    borderColor: 'border-green-200',
    hoverColor: 'hover:border-green-400',
  },
  {
    id: 'reparatie' as ServiceType,
    title: 'Reparatie',
    description: 'Reparatie van defecte airconditioning',
    icon: Wrench,
    duration: '1-3 uur',
    price: 'Vanaf €79 + onderdelen',
    color: 'bg-orange-500',
    lightColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    hoverColor: 'hover:border-orange-400',
  },
  {
    id: 'inspectie' as ServiceType,
    title: 'Inspectie',
    description: 'Controle en advies voor uw situatie',
    icon: Thermometer,
    duration: '30-60 min',
    price: 'Vanaf €59',
    color: 'bg-purple-500',
    lightColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    hoverColor: 'hover:border-purple-400',
  },
]

export default function BookingPage() {
  const router = useRouter()
  const [selectedService, setSelectedService] = useState<ServiceType | null>(null)

  const handleContinue = () => {
    if (selectedService) {
      router.push(`/booking/details?service=${selectedService}`)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Progress Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-center space-x-2">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
              1
            </div>
            <span className="ml-2 text-sm font-medium text-gray-900">Service kiezen</span>
          </div>
          <div className="w-24 h-1 bg-gray-200 mx-2"></div>
          <div className="flex items-center">
            <div className="w-8 h-8 bg-gray-200 text-gray-500 rounded-full flex items-center justify-center text-sm font-semibold">
              2
            </div>
            <span className="ml-2 text-sm text-gray-500">Gegevens</span>
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
          Welke service heeft u nodig?
        </h1>
        <p className="text-lg text-gray-600">
          Kies het type service dat het beste bij uw situatie past
        </p>
      </div>

      {/* Service Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {services.map((service) => {
          const Icon = service.icon
          const isSelected = selectedService === service.id
          
          return (
            <Card
              key={service.id}
              className={`relative cursor-pointer transition-all duration-200 ${service.borderColor} ${service.hoverColor} ${
                isSelected ? `ring-2 ring-offset-2 ring-${service.color.replace('bg-', '')}` : ''
              }`}
              onClick={() => setSelectedService(service.id)}
            >
              <div className="p-6">
                {isSelected && (
                  <div className="absolute top-4 right-4">
                    <div className={`w-6 h-6 ${service.color} rounded-full flex items-center justify-center`}>
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                )}
                
                <div className={`w-12 h-12 ${service.lightColor} rounded-lg flex items-center justify-center mb-4`}>
                  <Icon className={`w-6 h-6 text-${service.color.replace('bg-', '').replace('-500', '-600')}`} />
                </div>
                
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {service.title}
                </h3>
                <p className="text-gray-600 mb-4">
                  {service.description}
                </p>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center text-gray-500">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {service.duration}
                  </div>
                  <div className="font-semibold text-gray-900">
                    {service.price}
                  </div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => router.push('/')}
          className="flex items-center space-x-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Terug</span>
        </Button>
        
        <Button
          onClick={handleContinue}
          disabled={!selectedService}
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