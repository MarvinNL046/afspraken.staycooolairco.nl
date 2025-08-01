/**
 * Protected Booking Validation Endpoint
 * 
 * Example of a protected endpoint that requires authentication
 * to validate booking permissions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, AuthenticatedRequest } from '@/lib/middleware/auth.middleware';
import { withSecurity } from '@/lib/middleware/security.middleware';
import { securityLogger, SecurityEventType, LogLevel } from '@/lib/services/security/security-logger';
import { z } from 'zod';

// Request validation schema
const validateBookingSchema = z.object({
  datum: z.string().datetime(),
  tijd: z.string().regex(/^\d{2}:\d{2}$/),
  serviceType: z.enum(['installation', 'maintenance', 'repair', 'consultation']),
});

/**
 * POST /api/bookings/validate
 * Validate if the authenticated user can create a booking
 */
export async function POST(request: NextRequest) {
  return withSecurity(request, async (req) => {
    return withAuth(req, async (authenticatedReq: AuthenticatedRequest) => {
      try {
        // User is authenticated at this point
        const { leadId, email, sessionId } = authenticatedReq.auth!;

        // Parse request body
        const body = await authenticatedReq.json();
        const validation = validateBookingSchema.safeParse(body);

        if (!validation.success) {
          securityLogger.log(
            LogLevel.WARN,
            SecurityEventType.INPUT_VALIDATION_FAILED,
            'Invalid booking validation request',
            {
              leadId,
              errors: validation.error.issues,
            }
          );

          return NextResponse.json(
            {
              success: false,
              error: {
                message: 'Ongeldige invoer',
                code: 'VALIDATION_ERROR',
                details: validation.error.issues,
              },
            },
            { status: 400 }
          );
        }

        const { datum, tijd, serviceType } = validation.data;

        // Here you would implement actual booking validation logic
        // For example, check availability, business rules, etc.

        // Log successful validation
        securityLogger.log(
          LogLevel.INFO,
          SecurityEventType.AUTH_SUCCESS,
          'Booking validation successful',
          {
            leadId,
            sessionId,
            bookingDetails: {
              datum,
              tijd,
              serviceType,
            },
          }
        );

        return NextResponse.json(
          {
            success: true,
            data: {
              canBook: true,
              availableSlots: [
                { tijd: '09:00', available: true },
                { tijd: '11:00', available: true },
                { tijd: '13:00', available: false },
                { tijd: '15:00', available: true },
              ],
              estimatedDuration: 120, // minutes
              message: 'U kunt een afspraak maken voor deze datum en tijd',
            },
          },
          { status: 200 }
        );

      } catch (error) {
        console.error('Booking validation error:', error);
        
        securityLogger.logSuspiciousActivity(
          'Unexpected error during booking validation',
          authenticatedReq.auth?.leadId || 'unknown',
          {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );

        return NextResponse.json(
          {
            success: false,
            error: {
              message: 'Er is een fout opgetreden bij het valideren',
              code: 'SERVER_ERROR',
            },
          },
          { status: 500 }
        );
      }
    });
  }, {
    rateLimit: 'booking',
    csrf: true,
    ipBlocking: true,
  });
}

/**
 * GET /api/bookings/validate
 * Get validation rules and requirements
 */
export async function GET(request: NextRequest) {
  return withSecurity(request, async (req) => {
    return NextResponse.json(
      {
        success: true,
        data: {
          rules: {
            minAdvanceBooking: 24, // hours
            maxAdvanceBooking: 90, // days
            allowedServiceTypes: ['installation', 'maintenance', 'repair', 'consultation'],
            businessHours: {
              monday: { start: '08:00', end: '17:00' },
              tuesday: { start: '08:00', end: '17:00' },
              wednesday: { start: '08:00', end: '17:00' },
              thursday: { start: '08:00', end: '17:00' },
              friday: { start: '08:00', end: '17:00' },
              saturday: { start: '09:00', end: '13:00' },
              sunday: null, // closed
            },
            slotDuration: 120, // minutes
            bufferTime: 30, // minutes between appointments
          },
          requirements: {
            authentication: 'JWT Bearer token required',
            csrfToken: 'Required for POST requests',
            rateLimit: '5 requests per 15 minutes',
          },
        },
      },
      { status: 200 }
    );
  }, {
    rateLimit: 'api',
    csrf: false,
    ipBlocking: false,
  });
}