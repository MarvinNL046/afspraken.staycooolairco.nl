'use client'

import { useState, createContext, useContext, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StepIndicatorProps {
  steps: string[]
  currentStep: number
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="w-full mb-8">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const stepNumber = index + 1
          const isActive = stepNumber === currentStep
          const isCompleted = stepNumber < currentStep
          
          return (
            <div key={step} className="flex-1 relative">
              {/* Line connector */}
              {index > 0 && (
                <div
                  className={cn(
                    "absolute left-0 top-5 -translate-x-1/2 w-full h-0.5",
                    isCompleted || isActive ? "bg-primary" : "bg-gray-200"
                  )}
                />
              )}
              
              {/* Step circle and label */}
              <div className="relative flex flex-col items-center">
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-colors",
                    isActive && "bg-primary text-white shadow-lg",
                    isCompleted && "bg-primary text-white",
                    !isActive && !isCompleted && "bg-gray-200 text-gray-500"
                  )}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    stepNumber
                  )}
                </div>
                <span
                  className={cn(
                    "mt-2 text-sm font-medium transition-colors",
                    isActive && "text-primary",
                    isCompleted && "text-gray-700",
                    !isActive && !isCompleted && "text-gray-400"
                  )}
                >
                  {step}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Form context for state management
interface BookingFormData {
  // Service selection
  serviceType: 'installation' | 'maintenance' | 'repair' | 'inspection'
  description?: string
  
  // Location & address
  address: string
  postalCode: string
  city: string
  houseNumber: string
  houseNumberExt?: string
  latitude?: number
  longitude?: number
  
  // Date & time
  scheduledDate?: Date
  scheduledTime?: string
  preferredTimeSlot?: 'morning' | 'afternoon' | 'flexible'
  
  // Customer details
  customerType: 'residential' | 'business'
  firstName: string
  lastName: string
  company?: string
  email: string
  phone: string
  notes?: string
}

interface BookingFormContextType {
  formData: BookingFormData
  updateFormData: (data: Partial<BookingFormData>) => void
  currentStep: number
  setCurrentStep: (step: number) => void
  canProceed: boolean
  setCanProceed: (value: boolean) => void
}

const BookingFormContext = createContext<BookingFormContextType | undefined>(undefined)

export function useBookingForm() {
  const context = useContext(BookingFormContext)
  if (!context) {
    throw new Error('useBookingForm must be used within BookingFormProvider')
  }
  return context
}

interface BookingFormProviderProps {
  children: ReactNode
}

export function BookingFormProvider({ children }: BookingFormProviderProps) {
  const [currentStep, setCurrentStep] = useState(1)
  const [canProceed, setCanProceed] = useState(false)
  const [formData, setFormData] = useState<BookingFormData>({
    serviceType: 'installation',
    customerType: 'residential',
    address: '',
    postalCode: '',
    city: '',
    houseNumber: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  })

  const updateFormData = (data: Partial<BookingFormData>) => {
    setFormData(prev => ({ ...prev, ...data }))
  }

  return (
    <BookingFormContext.Provider
      value={{
        formData,
        updateFormData,
        currentStep,
        setCurrentStep,
        canProceed,
        setCanProceed,
      }}
    >
      {children}
    </BookingFormContext.Provider>
  )
}

// Multi-step form container
interface MultiStepFormProps {
  steps: string[]
  children: ReactNode
}

export function MultiStepForm({ steps, children }: MultiStepFormProps) {
  const { currentStep } = useBookingForm()
  
  return (
    <div className="max-w-4xl mx-auto">
      <StepIndicator steps={steps} currentStep={currentStep} />
      <div className="bg-white rounded-lg shadow-sm border p-6">
        {children}
      </div>
    </div>
  )
}

// Form navigation buttons
interface FormNavigationProps {
  onNext?: () => void
  onPrevious?: () => void
  isFirstStep?: boolean
  isLastStep?: boolean
  loading?: boolean
}

export function FormNavigation({
  onNext,
  onPrevious,
  isFirstStep = false,
  isLastStep = false,
  loading = false,
}: FormNavigationProps) {
  const { canProceed } = useBookingForm()
  
  return (
    <div className="flex justify-between mt-8">
      {!isFirstStep && (
        <button
          type="button"
          onClick={onPrevious}
          className="px-6 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
        >
          Vorige
        </button>
      )}
      
      <div className="ml-auto">
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed || loading}
          className={cn(
            "px-6 py-2 rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary",
            canProceed && !loading
              ? "bg-primary hover:bg-primary/90"
              : "bg-gray-300 cursor-not-allowed"
          )}
        >
          {loading ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Bezig...
            </span>
          ) : isLastStep ? (
            'Bevestigen'
          ) : (
            'Volgende'
          )}
        </button>
      </div>
    </div>
  )
}