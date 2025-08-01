import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { createCalendarEvent } from '../../lib/google-calendar';
import { markSlotAsBooked } from '../../lib/availability';
import { z, ZodError } from 'zod';
import { parseISO, isValid, format, addHours } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import jwt from 'jsonwebtoken';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import { boundaryValidator } from '../../lib/boundary-validator';
import { DutchAddress } from '../../types/google-maps';

const prisma = new PrismaClient();

// Validation schema for appointment creation
const appointmentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  serviceType: z.enum(['installation', 'maintenance', 'repair', 'consultation', 'installatie', 'onderhoud', 'reparatie', 'consultatie']),
  customerInfo: z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Invalid email address'),
    phone: z.string().min(10, 'Phone number is required'),
    address: z.string().min(1, 'Address is required'),
    city: z.string().min(1, 'City is required'),
    postalCode: z.string().regex(/^\d{4}\s?[A-Z]{2}$/i, 'Invalid Dutch postal code'),
  }),
  notes: z.string().optional(),
  bookingToken: z.string().min(1, 'Booking token is required'),
});

/**
 * Netlify Function to create an appointment with Google Calendar integration
 * Endpoint: /.netlify/functions/create-appointment
 * Method: POST
 * Body: JSON with appointment details
 * 
 * Creates appointment in database and syncs with Google Calendar
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('POST, OPTIONS');
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return createErrorResponse(405, 'Method not allowed');
  }

  try {
    // Parse and validate request body
    if (!event.body) {
      return createErrorResponse(400, 'Request body is required');
    }

    const body = JSON.parse(event.body);
    const validatedData = appointmentSchema.parse(body);

    // Verify booking token
    const tokenSecret = process.env.JWT_SECRET || 'your-secret-key';
    let tokenPayload: any;
    
    try {
      tokenPayload = jwt.verify(validatedData.bookingToken, tokenSecret) as any;
    } catch (error) {
      return createErrorResponse(401, 'Invalid or expired booking token');
    }

    // Verify lead exists
    const lead = await prisma.lead.findUnique({
      where: { id: tokenPayload.leadId }
    });

    if (!lead) {
      return createErrorResponse(404, 'Lead not found');
    }

    // Validate service boundaries
    const customerAddress: DutchAddress = {
      street: validatedData.customerInfo.address.split(' ').slice(0, -1).join(' '), // Extract street name
      houseNumber: validatedData.customerInfo.address.split(' ').pop() || '', // Extract house number
      postalCode: validatedData.customerInfo.postalCode.toUpperCase().replace(/\s/g, ''),
      city: validatedData.customerInfo.city,
    };

    const boundaryValidation = await boundaryValidator.validateAddress(customerAddress);
    
    if (!boundaryValidation.isValid) {
      return createErrorResponse(400, 'Address outside service area', {
        message: boundaryValidation.message || 'Het adres ligt buiten ons servicegebied (provincie Limburg)',
        confidence: boundaryValidation.confidence,
        validationMethod: boundaryValidation.validationMethod,
      });
    }

    // Parse date and time in Dutch timezone
    const appointmentDate = parseISO(validatedData.date);
    if (!isValid(appointmentDate)) {
      return createErrorResponse(400, 'Invalid date format');
    }

    // Create full datetime in Amsterdam timezone
    const [hours, minutes] = validatedData.startTime.split(':').map(Number);
    const amsterdamDateTime = new Date(appointmentDate);
    amsterdamDateTime.setHours(hours, minutes, 0, 0);
    
    // Convert to UTC for database storage
    const utcDateTime = fromZonedTime(amsterdamDateTime, 'Europe/Amsterdam');
    const endDateTime = addHours(utcDateTime, 2); // 2-hour appointment slots

    // Check if slot is still available
    const existingAppointment = await prisma.afspraak.findFirst({
      where: {
        datum: utcDateTime,
        status: {
          in: ['gepland', 'bevestigd']
        }
      }
    });

    if (existingAppointment) {
      return createErrorResponse(409, 'Time slot no longer available', {
        message: 'This time slot has been booked by another customer. Please select a different time.'
      });
    }

    // Create customer record
    const customer = await prisma.customer.upsert({
      where: { email: validatedData.customerInfo.email },
      update: {
        phone: validatedData.customerInfo.phone,
        address: validatedData.customerInfo.address,
        city: validatedData.customerInfo.city,
        postalCode: validatedData.customerInfo.postalCode,
      },
      create: {
        firstName: validatedData.customerInfo.firstName,
        lastName: validatedData.customerInfo.lastName,
        email: validatedData.customerInfo.email,
        phone: validatedData.customerInfo.phone,
        address: validatedData.customerInfo.address,
        city: validatedData.customerInfo.city,
        postalCode: validatedData.customerInfo.postalCode,
      }
    });

    // Create appointment in database with service area color
    const appointment = await prisma.afspraak.create({
      data: {
        leadId: lead.id,
        customerId: customer.id,
        datum: utcDateTime,
        tijd: validatedData.startTime,
        serviceType: validatedData.serviceType,
        beschrijving: validatedData.notes || '',
        locatie: `${customer.address}, ${customer.postalCode} ${customer.city}`,
        status: 'gepland',
        colorId: boundaryValidation.calendarColorId || '5', // Yellow (5) for Limburg
      },
      include: {
        lead: true,
        customer: true,
      }
    });

    // Create Google Calendar event
    try {
      const calendarEventId = await createCalendarEvent(appointment);

      // Update appointment with Google Calendar event ID
      if (calendarEventId) {
        await prisma.afspraak.update({
          where: { id: appointment.id },
          data: { googleEventId: calendarEventId }
        });
      }

      // Mark the time slot as booked
      await markSlotAsBooked(utcDateTime, validatedData.startTime);

    } catch (calendarError) {
      console.error('Error creating Google Calendar event:', calendarError);
      // Continue without failing - appointment is still created in database
    }

    // Format response
    const response = {
      success: true,
      appointment: {
        id: appointment.id,
        date: format(amsterdamDateTime, 'yyyy-MM-dd'),
        tijd: validatedData.startTime,
        endTime: format(addHours(amsterdamDateTime, 2), 'HH:mm'),
        serviceType: appointment.serviceType,
        status: appointment.status,
        customer: {
          name: `${customer.firstName} ${customer.lastName}`,
          email: customer.email,
          phone: customer.phone,
          address: `${customer.address}, ${customer.postalCode} ${customer.city}`,
        },
        timezone: 'Europe/Amsterdam',
        googleCalendarSynced: !!appointment.googleEventId,
      },
      message: 'Appointment successfully created',
    };

    return createResponse(201, response);

  } catch (error) {
    console.error('Error creating appointment:', error);
    
    // Handle validation errors
    if (error instanceof ZodError) {
      return createErrorResponse(400, 'Validation error', {
        details: error.issues
      });
    }

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while creating the appointment. Please try again later.'
    });
  } finally {
    // Ensure database connection is closed
    await prisma.$disconnect();
  }
};