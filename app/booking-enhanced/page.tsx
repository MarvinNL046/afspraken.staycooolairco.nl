'use client'

import { BookingFormProvider, MultiStepForm, useBookingForm } from '@/components/booking/multi-step-form'
import { ServiceSelectionStep } from '@/components/booking/steps/service-selection'
import { AddressInputStep } from '@/components/booking/steps/address-input'
import { DateTimeSelectionStep } from '@/components/booking/steps/date-time-selection'
import { CustomerDetailsStep } from '@/components/booking/steps/customer-details'
import { ReviewConfirmStep } from '@/components/booking/steps/review-confirm'

const steps = [
  'Service',
  'Locatie',
  'Datum & Tijd',
  'Gegevens',
  'Bevestigen',
]

function BookingFormContent() {
  const { currentStep } = useBookingForm()

  return (
    <MultiStepForm steps={steps}>
      {currentStep === 1 && <ServiceSelectionStep />}
      {currentStep === 2 && <AddressInputStep />}
      {currentStep === 3 && <DateTimeSelectionStep />}
      {currentStep === 4 && <CustomerDetailsStep />}
      {currentStep === 5 && <ReviewConfirmStep />}
    </MultiStepForm>
  )
}

export default function EnhancedBookingPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Plan uw afspraak
          </h1>
          <p className="text-lg text-gray-600">
            Boek eenvoudig een afspraak met onze slimme routeplanning
          </p>
        </div>

        <BookingFormProvider>
          <BookingFormContent />
        </BookingFormProvider>
      </div>
    </div>
  )
}