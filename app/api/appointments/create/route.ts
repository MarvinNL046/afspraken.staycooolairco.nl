import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { format } from 'date-fns'

// Validation schema
const appointmentSchema = z.object({
  service: z.enum(['installatie', 'onderhoud', 'reparatie', 'inspectie']),
  customer: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    address: z.string().min(1),
    houseNumber: z.string().min(1),
    houseNumberExt: z.string().optional(),
    postalCode: z.string().regex(/^\d{4}\s?[A-Z]{2}$/i),
    city: z.string().min(1),
  }),
  notes: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate request body
    const validatedData = appointmentSchema.parse(body)
    
    // Check if address is in Limburg (postal code 5800-6999)
    const postalCodeNum = parseInt(validatedData.customer.postalCode.replace(/\s/g, ''))
    if (postalCodeNum < 5800 || postalCodeNum > 6999) {
      return NextResponse.json({
        success: false,
        error: 'Address outside service area',
        message: 'We only provide services in the Limburg province.',
      }, { status: 400 })
    }
    
    // Here you would typically:
    // 1. Check availability in database
    // 2. Create appointment in database
    // 3. Send confirmation email
    // 4. Create Google Calendar event
    // 5. Send SMS notification
    
    // For now, simulate successful creation
    const appointmentId = `APT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    return NextResponse.json({
      success: true,
      appointment: {
        id: appointmentId,
        ...validatedData,
        status: 'confirmed',
        createdAt: new Date().toISOString(),
      },
      message: 'Appointment successfully created',
    })
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Validation error',
        details: error.issues,
      }, { status: 400 })
    }
    
    console.error('Error creating appointment:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
      message: 'An error occurred while creating the appointment.',
    }, { status: 500 })
  }
}