import { z } from 'zod'

// Dutch phone number validation
export const dutchPhoneRegex = /^((\+31|0031|0)[6]{1}[0-9]{8}|(\+31|0031|0)[1-9]{1}[0-9]{8})$/

// Dutch postal code validation
export const dutchPostalCodeRegex = /^[1-9][0-9]{3}\s?[A-Z]{2}$/i

// Customer validation schema
export const customerSchema = z.object({
  firstName: z.string()
    .min(1, 'Voornaam is verplicht')
    .max(50, 'Voornaam mag maximaal 50 karakters zijn'),
  
  lastName: z.string()
    .min(1, 'Achternaam is verplicht')
    .max(50, 'Achternaam mag maximaal 50 karakters zijn'),
  
  email: z.string()
    .min(1, 'E-mailadres is verplicht')
    .email('Ongeldig e-mailadres'),
  
  phone: z.string()
    .min(1, 'Telefoonnummer is verplicht')
    .regex(dutchPhoneRegex, 'Ongeldig telefoonnummer'),
  
  address: z.string()
    .min(1, 'Straatnaam is verplicht')
    .max(100, 'Straatnaam mag maximaal 100 karakters zijn'),
  
  houseNumber: z.string()
    .min(1, 'Huisnummer is verplicht')
    .regex(/^\d+$/, 'Huisnummer moet een getal zijn'),
  
  houseNumberExt: z.string()
    .optional()
    .transform(val => val?.trim() || undefined),
  
  postalCode: z.string()
    .min(1, 'Postcode is verplicht')
    .regex(dutchPostalCodeRegex, 'Ongeldige postcode (bijv. 1234 AB)'),
  
  city: z.string()
    .min(1, 'Plaats is verplicht')
    .max(50, 'Plaats mag maximaal 50 karakters zijn'),
  
  notes: z.string()
    .max(500, 'Opmerkingen mogen maximaal 500 karakters zijn')
    .optional(),
})

// Service type validation
export const serviceTypeSchema = z.enum(['installatie', 'onderhoud', 'reparatie', 'inspectie'])

// Date validation
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ongeldige datum')

// Time validation
export const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Ongeldige tijd')

// Complete appointment validation schema
export const appointmentSchema = z.object({
  service: serviceTypeSchema,
  customer: customerSchema,
  date: dateSchema,
  time: timeSchema,
})

// Helper function to format validation errors
export function formatValidationErrors(error: z.ZodError) {
  const errors: Record<string, string> = {}
  
  error.issues.forEach((err) => {
    const path = err.path.join('.')
    errors[path] = err.message
  })
  
  return errors
}

// Helper function to validate Limburg postal code
export function isLimburgPostalCode(postalCode: string): boolean {
  const cleaned = postalCode.replace(/\s/g, '')
  const numericPart = parseInt(cleaned.substring(0, 4))
  
  // Limburg postal codes range from 5800 to 6999
  return numericPart >= 5800 && numericPart <= 6999
}