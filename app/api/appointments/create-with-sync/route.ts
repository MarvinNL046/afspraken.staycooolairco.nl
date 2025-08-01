import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { format } from 'date-fns';
import { triggerAppointmentSync } from '../../../../lib/services/gohighlevel/appointment-sync.service';

const prisma = new PrismaClient();

// Enhanced validation schema
const appointmentSchema = z.object({
  service: z.enum(['installatie', 'onderhoud', 'reparatie', 'consultatie', 'installation', 'maintenance', 'repair', 'consultation']),
  leadId: z.string().uuid().optional(), // If appointment is for existing lead
  customer: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    company: z.string().optional(),
    address: z.string().min(1),
    houseNumber: z.string().min(1),
    houseNumberExt: z.string().optional(),
    postalCode: z.string().regex(/^\d{4}\s?[A-Z]{2}$/i),
    city: z.string().min(1),
  }),
  notes: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.number().min(30).max(480).optional().default(120), // Duration in minutes
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request body
    const validatedData = appointmentSchema.parse(body);
    
    // Check if address is in Limburg (postal code 5800-6999)
    const postalCodeNum = parseInt(validatedData.customer.postalCode.replace(/\s/g, ''));
    if (postalCodeNum < 5800 || postalCodeNum > 6999) {
      return NextResponse.json({
        success: false,
        error: 'Address outside service area',
        message: 'We only provide services in the Limburg province.',
      }, { status: 400 });
    }
    
    // Map service types
    const serviceTypeMap: Record<string, string> = {
      'installatie': 'installation',
      'onderhoud': 'maintenance',
      'reparatie': 'repair',
      'consultatie': 'consultation',
    };
    
    const serviceType = serviceTypeMap[validatedData.service] || validatedData.service;
    
    // Format full address
    const fullAddress = `${validatedData.customer.address} ${validatedData.customer.houseNumber}${validatedData.customer.houseNumberExt || ''}, ${validatedData.customer.postalCode} ${validatedData.customer.city}`;
    
    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Check if customer exists or create new
      let customer = await tx.customer.findUnique({
        where: { email: validatedData.customer.email }
      });
      
      if (!customer) {
        customer = await tx.customer.create({
          data: {
            email: validatedData.customer.email,
            firstName: validatedData.customer.firstName,
            lastName: validatedData.customer.lastName,
            phone: validatedData.customer.phone,
            company: validatedData.customer.company,
            address: `${validatedData.customer.address} ${validatedData.customer.houseNumber}${validatedData.customer.houseNumberExt || ''}`,
            postalCode: validatedData.customer.postalCode,
            city: validatedData.customer.city,
          }
        });
      }
      
      // 2. Check if we have a lead for this customer
      let lead = null;
      if (validatedData.leadId) {
        lead = await tx.lead.findUnique({
          where: { id: validatedData.leadId }
        });
      } else {
        // Try to find lead by email
        lead = await tx.lead.findUnique({
          where: { email: validatedData.customer.email }
        });
      }
      
      // 3. Create appointment
      const appointment = await tx.afspraak.create({
        data: {
          leadId: lead?.id,
          customerId: customer.id,
          datum: new Date(validatedData.date),
          tijd: validatedData.time,
          duur: validatedData.duration,
          locatie: fullAddress,
          serviceType: serviceType as any,
          status: 'gepland',
          beschrijving: validatedData.notes,
          prioriteit: 0,
        },
        include: {
          lead: true,
          customer: true,
        }
      });
      
      // 4. Check if time slot needs to be marked as unavailable
      const appointmentDate = new Date(validatedData.date);
      const timeSlot = await tx.timeSlot.findUnique({
        where: {
          date_startTime: {
            date: appointmentDate,
            startTime: validatedData.time,
          }
        }
      });
      
      if (timeSlot) {
        await tx.timeSlot.update({
          where: { id: timeSlot.id },
          data: {
            currentBookings: { increment: 1 },
            isAvailable: timeSlot.currentBookings + 1 >= timeSlot.maxAppointments ? false : true,
          }
        });
      }
      
      return appointment;
    });
    
    // 5. Trigger GoHighLevel sync (async, don't wait)
    if (result.lead?.ghlContactId) {
      console.info('Triggering GoHighLevel sync for appointment', {
        appointmentId: result.id,
        ghlContactId: result.lead.ghlContactId,
      });
      
      // Don't await - let it run in background
      triggerAppointmentSync(result.id, 'create', {
        async: true,
        retryOnFailure: true,
      }).catch(error => {
        console.error('Failed to trigger GoHighLevel sync', {
          appointmentId: result.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }
    
    // 6. TODO: Additional integrations
    // - Send confirmation email
    // - Create Google Calendar event
    // - Send SMS notification
    
    return NextResponse.json({
      success: true,
      appointment: {
        id: result.id,
        date: format(result.datum, 'yyyy-MM-dd'),
        time: result.tijd,
        duration: result.duur,
        service: result.serviceType,
        location: result.locatie,
        status: result.status,
        customer: {
          name: `${result.customer?.firstName} ${result.customer?.lastName}`,
          email: result.customer?.email,
          phone: result.customer?.phone,
        },
        notes: result.beschrijving,
        createdAt: result.createdAt.toISOString(),
        ghlSyncInitiated: !!result.lead?.ghlContactId,
      },
      message: 'Appointment successfully created',
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Validation error',
        details: error.issues,
      }, { status: 400 });
    }
    
    console.error('Error creating appointment:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
      message: 'An error occurred while creating the appointment.',
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}

// Update appointment endpoint
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const appointmentId = body.appointmentId;
    
    if (!appointmentId) {
      return NextResponse.json({
        success: false,
        error: 'Appointment ID is required',
      }, { status: 400 });
    }
    
    // Update appointment logic here...
    const appointment = await prisma.afspraak.findUnique({
      where: { id: appointmentId },
      include: { lead: true }
    });
    
    if (!appointment) {
      return NextResponse.json({
        success: false,
        error: 'Appointment not found',
      }, { status: 404 });
    }
    
    // Perform update...
    // const updated = await prisma.afspraak.update({ ... });
    
    // Trigger sync if lead has GHL contact
    if (appointment.lead?.ghlContactId) {
      triggerAppointmentSync(appointmentId, 'update', {
        async: true,
        retryOnFailure: true,
      }).catch(error => {
        console.error('Failed to trigger GoHighLevel sync', {
          appointmentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }
    
    return NextResponse.json({
      success: true,
      message: 'Appointment updated',
    });
    
  } catch (error) {
    console.error('Error updating appointment:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}