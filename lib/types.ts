import { z } from 'zod'
import type { Afspraak, Lead, Customer, TimeSlot, RouteCluster, AfspraakStatus, ServiceType, KlantType } from '@prisma/client'

// Re-export Prisma types
export type { Afspraak, Lead, Customer, TimeSlot, RouteCluster, AfspraakStatus, ServiceType, KlantType }

// Backward compatibility aliases
export type Appointment = Afspraak
export type AppointmentStatus = AfspraakStatus
export type CustomerType = KlantType

// Form schemas
export const customerSchema = z.object({
  firstName: z.string().min(2, 'Voornaam moet minimaal 2 karakters zijn'),
  lastName: z.string().min(2, 'Achternaam moet minimaal 2 karakters zijn'),
  email: z.string().email('Ongeldig email adres'),
  phone: z.string().regex(/^(\+31|0)[1-9][0-9]{8}$/, 'Ongeldig telefoonnummer'),
  company: z.string().optional(),
  customerType: z.enum(['residential', 'business', 'particulier', 'zakelijk']),
  address: z.string().min(5, 'Adres is verplicht'),
  postalCode: z.string().regex(/^[1-9][0-9]{3}\s?[A-Z]{2}$/, 'Ongeldige postcode'),
  city: z.string().min(2, 'Stad is verplicht'),
  notes: z.string().optional()
})

export const appointmentSchema = z.object({
  serviceType: z.enum(['installation', 'maintenance', 'repair', 'consultation']),
  scheduledDate: z.date(),
  scheduledTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Ongeldige tijd'),
  description: z.string().optional(),
  customer: customerSchema
})

// API Response types
export type TimeSlotWithAvailability = TimeSlot & {
  available: boolean
}

export type AfspraakWithLead = Afspraak & {
  lead?: Lead | null
  customer?: Customer | null
}

// Backward compatibility alias
export type AppointmentWithCustomer = AfspraakWithLead

export type ApiResponse<T> = {
  success: boolean
  data?: T
  error?: string
}

// Service type labels
export const serviceTypeLabels: Record<string, string> = {
  installation: 'Installatie',
  maintenance: 'Onderhoud',
  repair: 'Reparatie',
  consultation: 'Adviesgesprek',
  installatie: 'Installatie',
  onderhoud: 'Onderhoud',
  reparatie: 'Reparatie',
  consultatie: 'Adviesgesprek'
}

// Status labels
export const statusLabels: Record<string, string> = {
  pending: 'In afwachting',
  confirmed: 'Bevestigd',
  cancelled: 'Geannuleerd',
  completed: 'Voltooid',
  no_show: 'Niet verschenen',
  gepland: 'Gepland',
  bevestigd: 'Bevestigd',
  geannuleerd: 'Geannuleerd',
  afgerond: 'Afgerond',
  niet_verschenen: 'Niet verschenen'
}

// Business hours configuration
export const BUSINESS_HOURS = {
  start: '08:00',
  end: '18:00',
  slotDuration: 120, // minutes
  breakTimes: [
    { start: '12:00', end: '13:00' } // Lunch break
  ]
}

// Date constraints
export const DATE_CONSTRAINTS = {
  minDaysAhead: 1, // Book at least 1 day in advance
  maxDaysAhead: 60, // Book max 60 days in advance
  excludeWeekends: true
}