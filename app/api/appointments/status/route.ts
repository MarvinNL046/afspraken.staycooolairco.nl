import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { triggerAppointmentSync } from '../../../../lib/services/gohighlevel/appointment-sync.service';

const prisma = new PrismaClient();

// Validation schema for status update
const statusUpdateSchema = z.object({
  appointmentId: z.string().uuid(),
  status: z.enum(['bevestigd', 'geannuleerd', 'afgerond', 'niet_verschenen']),
  notes: z.string().optional(),
  reason: z.string().optional(), // For cancellations
});

// Map internal status to sync action
const statusToSyncAction: Record<string, 'confirm' | 'cancel' | 'complete'> = {
  'bevestigd': 'confirm',
  'geannuleerd': 'cancel',
  'afgerond': 'complete',
  'niet_verschenen': 'cancel',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request
    const validatedData = statusUpdateSchema.parse(body);
    
    // Update appointment status
    const appointment = await prisma.afspraak.update({
      where: { id: validatedData.appointmentId },
      data: {
        status: validatedData.status,
        interneNotities: validatedData.notes 
          ? validatedData.notes 
          : validatedData.reason 
            ? `Geannuleerd: ${validatedData.reason}` 
            : undefined,
        updatedAt: new Date(),
      },
      include: {
        lead: true,
        customer: true,
      }
    });
    
    if (!appointment) {
      return NextResponse.json({
        success: false,
        error: 'Appointment not found',
      }, { status: 404 });
    }
    
    // Handle specific status actions
    switch (validatedData.status) {
      case 'geannuleerd':
        // Free up the time slot
        const timeSlot = await prisma.timeSlot.findUnique({
          where: {
            date_startTime: {
              date: appointment.datum,
              startTime: appointment.tijd,
            }
          }
        });
        
        if (timeSlot && timeSlot.currentBookings > 0) {
          await prisma.timeSlot.update({
            where: { id: timeSlot.id },
            data: {
              currentBookings: { decrement: 1 },
              isAvailable: true,
            }
          });
        }
        break;
        
      case 'afgerond':
        // Update customer to mark them as having completed service
        if (appointment.customerId) {
          await prisma.customer.update({
            where: { id: appointment.customerId },
            data: {
              notes: `Last service completed: ${appointment.datum.toISOString().split('T')[0]}`,
            }
          });
        }
        break;
    }
    
    // Trigger GoHighLevel sync if lead has GHL contact
    if (appointment.lead?.ghlContactId) {
      const syncAction = statusToSyncAction[validatedData.status];
      
      if (syncAction) {
        console.info('Triggering GoHighLevel sync for status update', {
          appointmentId: appointment.id,
          status: validatedData.status,
          syncAction,
          ghlContactId: appointment.lead.ghlContactId,
        });
        
        triggerAppointmentSync(appointment.id, syncAction, {
          async: true,
          retryOnFailure: true,
        }).catch(error => {
          console.error('Failed to trigger GoHighLevel sync', {
            appointmentId: appointment.id,
            status: validatedData.status,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      appointment: {
        id: appointment.id,
        status: appointment.status,
        previousStatus: body.previousStatus || 'gepland',
        updatedAt: appointment.updatedAt.toISOString(),
        customer: appointment.customer ? {
          name: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
          email: appointment.customer.email,
        } : null,
        ghlSyncInitiated: !!appointment.lead?.ghlContactId,
      },
      message: `Appointment status updated to ${validatedData.status}`,
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Validation error',
        details: error.issues,
      }, { status: 400 });
    }
    
    console.error('Error updating appointment status:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
      message: 'An error occurred while updating the appointment status.',
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}

// Batch status update endpoint
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    
    const batchSchema = z.object({
      appointments: z.array(statusUpdateSchema),
    });
    
    const validatedData = batchSchema.parse(body);
    
    const results = [];
    
    for (const update of validatedData.appointments) {
      try {
        // Update each appointment
        const appointment = await prisma.afspraak.update({
          where: { id: update.appointmentId },
          data: {
            status: update.status,
            interneNotities: update.notes,
            updatedAt: new Date(),
          },
          include: {
            lead: true,
          }
        });
        
        // Trigger sync if applicable
        if (appointment.lead?.ghlContactId) {
          const syncAction = statusToSyncAction[update.status];
          if (syncAction) {
            triggerAppointmentSync(appointment.id, syncAction, {
              async: true,
              retryOnFailure: true,
            }).catch(console.error);
          }
        }
        
        results.push({
          appointmentId: update.appointmentId,
          success: true,
          status: update.status,
        });
        
      } catch (error) {
        results.push({
          appointmentId: update.appointmentId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    return NextResponse.json({
      success: failed === 0,
      total: results.length,
      successful,
      failed,
      results,
      message: `Updated ${successful} appointments${failed > 0 ? `, ${failed} failed` : ''}`,
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Validation error',
        details: error.issues,
      }, { status: 400 });
    }
    
    console.error('Error in batch status update:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}