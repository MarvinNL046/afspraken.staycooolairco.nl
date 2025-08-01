'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { Calendar, Clock, User, Phone, Mail, Home, Building2, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { DatePicker } from './date-picker'
import { TimePicker } from './time-picker'
import { appointmentSchema, serviceTypeLabels } from '@/lib/types'
import type { TimeSlotWithAvailability } from '@/lib/types'
import { formatDate } from '@/lib/utils'

export function BookingForm() {
  const [currentStep, setCurrentStep] = useState(1)
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [timeSlots, setTimeSlots] = useState<TimeSlotWithAvailability[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors }
  } = useForm({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      serviceType: 'installation',
      customer: {
        customerType: 'residential'
      }
    }
  })
  
  const selectedDate = watch('scheduledDate')
  const selectedTime = watch('scheduledTime')
  const customerType = watch('customer.customerType')
  
  // Fetch available dates on mount
  useEffect(() => {
    fetchAvailableDates()
  }, [])
  
  // Fetch time slots when date changes
  useEffect(() => {
    if (selectedDate) {
      fetchTimeSlots(selectedDate)
    }
  }, [selectedDate])
  
  const fetchAvailableDates = async () => {
    try {
      const response = await fetch('/.netlify/functions/availability?type=dates')
      const data = await response.json()
      if (data.success) {
        setAvailableDates(data.data)
      }
    } catch (error) {
      console.error('Error fetching available dates:', error)
    }
  }
  
  const fetchTimeSlots = async (date: Date) => {
    setLoading(true)
    try {
      const dateStr = format(date, 'yyyy-MM-dd')
      const response = await fetch(`/.netlify/functions/availability?date=${dateStr}`)
      const data = await response.json()
      if (data.success) {
        setTimeSlots(data.data)
      }
    } catch (error) {
      console.error('Error fetching time slots:', error)
    } finally {
      setLoading(false)
    }
  }
  
  const onSubmit = async (data: any) => {
    setSubmitting(true)
    try {
      const response = await fetch('/.netlify/functions/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      
      const result = await response.json()
      
      if (result.success) {
        setSuccess(true)
        // Reset form or redirect
      } else {
        alert('Er is een fout opgetreden. Probeer het opnieuw.')
      }
    } catch (error) {
      console.error('Error submitting appointment:', error)
      alert('Er is een fout opgetreden. Probeer het opnieuw.')
    } finally {
      setSubmitting(false)
    }
  }
  
  if (success) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <CardTitle>Afspraak Bevestigd!</CardTitle>
          <CardDescription>
            Uw afspraak is succesvol ingepland. U ontvangt een bevestiging per e-mail.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-gray-600">
            {selectedDate && formatDate(selectedDate)} om {selectedTime && formatTime(selectedTime)}
          </p>
        </CardContent>
        <CardFooter className="justify-center">
          <Button onClick={() => window.location.reload()}>
            Nieuwe afspraak maken
          </Button>
        </CardFooter>
      </Card>
    )
  }
  
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl mx-auto">
      {/* Step 1: Service Selection */}
      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Selecteer een service</CardTitle>
            <CardDescription>
              Kies het type service dat u nodig heeft
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Type service
              </label>
              <Select {...register('serviceType')}>
                {Object.entries(serviceTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">
                Omschrijving (optioneel)
              </label>
              <Textarea
                {...register('description')}
                placeholder="Beschrijf hier eventuele specifieke wensen of problemen..."
                rows={4}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="button" onClick={() => setCurrentStep(2)}>
              Volgende
            </Button>
          </CardFooter>
        </Card>
      )}
      
      {/* Step 2: Date & Time Selection */}
      {currentStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Kies datum en tijd</CardTitle>
            <CardDescription>
              Selecteer een beschikbare datum en tijdslot
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-4">
                <Calendar className="inline h-4 w-4 mr-1" />
                Selecteer een datum
              </label>
              <DatePicker
                value={selectedDate}
                onChange={(date) => setValue('scheduledDate', date)}
                availableDates={availableDates}
                minDate={new Date()}
              />
            </div>
            
            {selectedDate && (
              <div>
                <label className="block text-sm font-medium mb-4">
                  <Clock className="inline h-4 w-4 mr-1" />
                  Selecteer een tijdslot
                </label>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <TimePicker
                    value={selectedTime}
                    onChange={(time) => setValue('scheduledTime', time)}
                    slots={timeSlots}
                  />
                )}
              </div>
            )}
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" onClick={() => setCurrentStep(1)}>
              Vorige
            </Button>
            <Button 
              type="button" 
              onClick={() => setCurrentStep(3)}
              disabled={!selectedDate || !selectedTime}
            >
              Volgende
            </Button>
          </CardFooter>
        </Card>
      )}
      
      {/* Step 3: Contact Information */}
      {currentStep === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Contactgegevens</CardTitle>
            <CardDescription>
              Vul uw gegevens in zodat we contact met u kunnen opnemen
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Type klant
              </label>
              <Select {...register('customer.customerType')}>
                <option value="residential">Particulier</option>
                <option value="business">Zakelijk</option>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  <User className="inline h-4 w-4 mr-1" />
                  Voornaam
                </label>
                <Input {...register('customer.firstName')} />
                {errors.customer?.firstName && (
                  <p className="text-red-500 text-sm mt-1">{errors.customer.firstName.message}</p>
                )}
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">
                  Achternaam
                </label>
                <Input {...register('customer.lastName')} />
                {errors.customer?.lastName && (
                  <p className="text-red-500 text-sm mt-1">{errors.customer.lastName.message}</p>
                )}
              </div>
            </div>
            
            {customerType === 'business' && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  <Building2 className="inline h-4 w-4 mr-1" />
                  Bedrijfsnaam
                </label>
                <Input {...register('customer.company')} />
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium mb-2">
                <Mail className="inline h-4 w-4 mr-1" />
                E-mailadres
              </label>
              <Input type="email" {...register('customer.email')} />
              {errors.customer?.email && (
                <p className="text-red-500 text-sm mt-1">{errors.customer.email.message}</p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">
                <Phone className="inline h-4 w-4 mr-1" />
                Telefoonnummer
              </label>
              <Input type="tel" {...register('customer.phone')} placeholder="06-12345678" />
              {errors.customer?.phone && (
                <p className="text-red-500 text-sm mt-1">{errors.customer.phone.message}</p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">
                <Home className="inline h-4 w-4 mr-1" />
                Adres
              </label>
              <Input {...register('customer.address')} />
              {errors.customer?.address && (
                <p className="text-red-500 text-sm mt-1">{errors.customer.address.message}</p>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Postcode
                </label>
                <Input {...register('customer.postalCode')} placeholder="1234 AB" />
                {errors.customer?.postalCode && (
                  <p className="text-red-500 text-sm mt-1">{errors.customer.postalCode.message}</p>
                )}
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">
                  Stad
                </label>
                <Input {...register('customer.city')} />
                {errors.customer?.city && (
                  <p className="text-red-500 text-sm mt-1">{errors.customer.city.message}</p>
                )}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">
                <FileText className="inline h-4 w-4 mr-1" />
                Opmerkingen (optioneel)
              </label>
              <Textarea
                {...register('customer.notes')}
                placeholder="Eventuele bijzonderheden..."
                rows={3}
              />
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" onClick={() => setCurrentStep(2)}>
              Vorige
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Bezig met versturen...
                </>
              ) : (
                'Afspraak bevestigen'
              )}
            </Button>
          </CardFooter>
        </Card>
      )}
    </form>
  )
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
}