'use client'

import { useEffect } from 'react'
import { Wrench, Shield, Search, Snowflake } from 'lucide-react'
import { useBookingForm } from '../multi-step-form'
import { cn } from '@/lib/utils'

const services = [
  {
    id: 'installation',
    title: 'Installatie',
    description: 'Nieuwe airconditioning installeren',
    icon: Snowflake,
    duration: '2-4 uur',
    price: 'Vanaf €1.500',
  },
  {
    id: 'maintenance',
    title: 'Onderhoud',
    description: 'Periodiek onderhoud en reiniging',
    icon: Shield,
    duration: '1-2 uur',
    price: 'Vanaf €125',
  },
  {
    id: 'repair',
    title: 'Reparatie',
    description: 'Storingen verhelpen',
    icon: Wrench,
    duration: '1-3 uur',
    price: 'Vanaf €95',
  },
  {
    id: 'inspection',
    title: 'Inspectie',
    description: 'Controle en advies',
    icon: Search,
    duration: '30-60 min',
    price: 'Vanaf €75',
  },
]

export function ServiceSelectionStep() {
  const { formData, updateFormData, setCanProceed, setCurrentStep } = useBookingForm()

  useEffect(() => {
    setCanProceed(!!formData.serviceType)
  }, [formData.serviceType, setCanProceed])

  const handleServiceSelect = (serviceId: string) => {
    updateFormData({ serviceType: serviceId as any })
  }

  const handleNext = () => {
    if (formData.serviceType) {
      setCurrentStep(2)
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Welke service heeft u nodig?
      </h2>
      <p className="text-gray-600 mb-8">
        Selecteer het type service dat u wenst voor uw airconditioning
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {services.map((service) => {
          const Icon = service.icon
          const isSelected = formData.serviceType === service.id
          
          return (
            <button
              key={service.id}
              type="button"
              onClick={() => handleServiceSelect(service.id)}
              className={cn(
                "relative rounded-lg border-2 p-6 text-left transition-all hover:shadow-md",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-gray-200 hover:border-gray-300"
              )}
            >
              {isSelected && (
                <div className="absolute top-4 right-4">
                  <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              )}
              
              <div className="flex items-start">
                <div className={cn(
                  "flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center",
                  isSelected ? "bg-primary/10" : "bg-gray-100"
                )}>
                  <Icon className={cn(
                    "w-6 h-6",
                    isSelected ? "text-primary" : "text-gray-600"
                  )} />
                </div>
                
                <div className="ml-4 flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {service.title}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {service.description}
                  </p>
                  <div className="flex items-center gap-4 mt-3 text-sm">
                    <span className="text-gray-500">
                      ⏱ {service.duration}
                    </span>
                    <span className="text-gray-500">
                      € {service.price}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mb-8">
        <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
          Aanvullende informatie (optioneel)
        </label>
        <textarea
          id="description"
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary"
          placeholder="Beschrijf hier eventuele specifieke wensen of problemen..."
          value={formData.description || ''}
          onChange={(e) => updateFormData({ description: e.target.value })}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleNext}
          disabled={!formData.serviceType}
          className={cn(
            "px-6 py-2 rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary",
            formData.serviceType
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