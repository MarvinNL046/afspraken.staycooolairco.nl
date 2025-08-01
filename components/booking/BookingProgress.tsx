'use client'

import { Check } from 'lucide-react'

interface Step {
  id: number
  name: string
  status: 'completed' | 'current' | 'upcoming'
}

interface BookingProgressProps {
  currentStep: number
}

export function BookingProgress({ currentStep }: BookingProgressProps) {
  const steps: Step[] = [
    { id: 1, name: 'Service', status: currentStep > 1 ? 'completed' : currentStep === 1 ? 'current' : 'upcoming' },
    { id: 2, name: 'Gegevens', status: currentStep > 2 ? 'completed' : currentStep === 2 ? 'current' : 'upcoming' },
    { id: 3, name: 'Planning', status: currentStep > 3 ? 'completed' : currentStep === 3 ? 'current' : 'upcoming' },
    { id: 4, name: 'Bevestiging', status: currentStep > 4 ? 'completed' : currentStep === 4 ? 'current' : 'upcoming' },
  ]

  return (
    <nav aria-label="Progress">
      <ol className="flex items-center">
        {steps.map((step, stepIdx) => (
          <li key={step.name} className={`${stepIdx !== steps.length - 1 ? 'flex-1' : ''} flex items-center`}>
            <div className="flex items-center group">
              <span className="flex items-center">
                <span
                  className={`
                    flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full
                    ${
                      step.status === 'completed'
                        ? 'bg-green-600'
                        : step.status === 'current'
                        ? 'bg-blue-600'
                        : 'bg-gray-200'
                    }
                  `}
                >
                  {step.status === 'completed' ? (
                    <Check className="w-6 h-6 text-white" />
                  ) : (
                    <span
                      className={`
                        text-sm font-medium
                        ${
                          step.status === 'current'
                            ? 'text-white'
                            : 'text-gray-500'
                        }
                      `}
                    >
                      {step.id}
                    </span>
                  )}
                </span>
                <span
                  className={`
                    ml-3 text-sm font-medium hidden sm:block
                    ${
                      step.status === 'completed'
                        ? 'text-gray-900'
                        : step.status === 'current'
                        ? 'text-blue-600'
                        : 'text-gray-500'
                    }
                  `}
                >
                  {step.name}
                </span>
              </span>
            </div>
            {stepIdx !== steps.length - 1 && (
              <div className="flex-1 ml-4">
                <div className="h-0.5 bg-gray-200">
                  <div
                    className={`h-0.5 transition-all duration-500 ${
                      step.status === 'completed' ? 'bg-green-600' : 'bg-gray-200'
                    }`}
                  />
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}