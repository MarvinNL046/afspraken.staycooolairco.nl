/**
 * Booking Token Generation API
 * 
 * Secure endpoint for generating JWT tokens for authenticated booking sessions.
 * Implements comprehensive security measures including rate limiting and validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { jwtService } from '@/lib/services/auth/jwt.service';
import { createLeadValidationService, LeadValidationError } from '@/lib/services/auth/lead-validation.service';
import { withSecurity, sanitizeInput, generateCSRFToken } from '@/lib/middleware/security.middleware';
import { applySecurityHeaders } from '@/lib/middleware/auth.middleware';
import { randomUUID } from 'crypto';

// Initialize Prisma client
const prisma = new PrismaClient();
const leadValidationService = createLeadValidationService(prisma);

// Request validation schema
const bookingTokenRequestSchema = z.object({
  email: z.string().email('Ongeldig e-mailadres').max(254),
  ghlId: z.string().min(1, 'GoHighLevel ID is verplicht').max(100),
  verificationCode: z.string().length(6).optional(),
});

// Response types
interface BookingTokenResponse {
  success: boolean;
  data?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    csrfToken: string;
    leadInfo: {
      naam: string;
      email: string;
      klantType: string;
    };
  };
  requiresVerification?: boolean;
  error?: {
    message: string;
    code: string;
  };
}

/**
 * POST /api/auth/booking-token
 * Generate a booking token for a validated lead
 */
export async function POST(request: NextRequest) {
  return withSecurity(request, async (req) => {
    try {
      // Parse and validate request body
      const body = sanitizeInput(await req.json());
      const validation = bookingTokenRequestSchema.safeParse(body);

      if (!validation.success) {
        return createErrorResponse(
          'Ongeldige invoer: ' + validation.error.issues[0].message,
          400,
          'VALIDATION_ERROR'
        );
      }

      const { email, ghlId, verificationCode } = validation.data;

      // Get client metadata
      const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
      const userAgent = req.headers.get('user-agent') || 'unknown';

      // Handle verification code if provided
      if (verificationCode) {
        const isValidCode = await leadValidationService.verifyCode(email, verificationCode);
        if (!isValidCode) {
          return createErrorResponse(
            'Ongeldige verificatiecode',
            400,
            'INVALID_VERIFICATION_CODE'
          );
        }
      }

      // Validate lead
      const validationResult = await leadValidationService.validateLead(email, ghlId);

      if (validationResult.requiresVerification && !verificationCode) {
        // Generate and send verification code
        await leadValidationService.generateVerificationCode(email);
        
        return NextResponse.json<BookingTokenResponse>(
          {
            success: false,
            requiresVerification: true,
            error: {
              message: 'Verificatiecode verzonden naar uw e-mailadres',
              code: 'VERIFICATION_REQUIRED',
            },
          },
          { status: 200 }
        );
      }

      if (!validationResult.isValid || !validationResult.lead) {
        return createErrorResponse(
          validationResult.error || 'Lead validatie mislukt',
          401,
          'INVALID_CREDENTIALS'
        );
      }

      const lead = validationResult.lead;

      // Generate tokens
      const tokenPair = await jwtService.generateBookingToken(
        lead.id,
        lead.email,
        { ipAddress, userAgent }
      );

      // Generate session ID and CSRF token
      const sessionId = randomUUID();
      const csrfToken = generateCSRFToken(sessionId);

      // Create response
      const response = NextResponse.json<BookingTokenResponse>(
        {
          success: true,
          data: {
            ...tokenPair,
            csrfToken,
            leadInfo: {
              naam: lead.naam,
              email: lead.email,
              klantType: lead.klantType,
            },
          },
        },
        { status: 200 }
      );

      // Set secure cookies
      response.cookies.set('booking-token', tokenPair.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 3600, // 1 hour
        path: '/',
      });

      response.cookies.set('refresh-token', tokenPair.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 604800, // 7 days
        path: '/api/auth',
      });

      response.cookies.set('session-id', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 604800, // 7 days
        path: '/',
      });

      // Log successful authentication (without sensitive data)
      console.log('Booking token generated:', {
        leadId: lead.id,
        sessionId,
        timestamp: new Date().toISOString(),
      });

      return applySecurityHeaders(response);

    } catch (error) {
      console.error('Booking token generation error:', error);

      if (error instanceof LeadValidationError) {
        const statusCode = error.code === 'BLOCKED' ? 429 : 401;
        return createErrorResponse(error.message, statusCode, error.code);
      }

      return createErrorResponse(
        'Er is een fout opgetreden bij het genereren van de token',
        500,
        'SERVER_ERROR'
      );
    }
  }, {
    rateLimit: 'auth',
    csrf: false, // CSRF not needed for token generation
    ipBlocking: true,
  });
}

/**
 * POST /api/auth/booking-token/refresh
 * Refresh an expired access token
 */
export async function PATCH(request: NextRequest) {
  return withSecurity(request, async (req) => {
    try {
      // Get refresh token from cookie
      const refreshToken = req.cookies.get('refresh-token')?.value;
      
      if (!refreshToken) {
        return createErrorResponse(
          'Geen refresh token gevonden',
          401,
          'NO_REFRESH_TOKEN'
        );
      }

      // Get client metadata
      const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
      const userAgent = req.headers.get('user-agent') || 'unknown';

      // Refresh the token
      const tokenPair = await jwtService.refreshAccessToken(
        refreshToken,
        { ipAddress, userAgent }
      );

      // Get session ID for CSRF
      const sessionId = req.cookies.get('session-id')?.value || randomUUID();
      const csrfToken = generateCSRFToken(sessionId);

      // Create response
      const response = NextResponse.json<BookingTokenResponse>(
        {
          success: true,
          data: {
            ...tokenPair,
            csrfToken,
            leadInfo: {
              naam: '',
              email: '',
              klantType: '',
            },
          },
        },
        { status: 200 }
      );

      // Update cookies
      response.cookies.set('booking-token', tokenPair.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 3600,
        path: '/',
      });

      response.cookies.set('refresh-token', tokenPair.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 604800,
        path: '/api/auth',
      });

      return applySecurityHeaders(response);

    } catch (error) {
      console.error('Token refresh error:', error);
      
      return createErrorResponse(
        'Kan token niet vernieuwen',
        401,
        'REFRESH_FAILED'
      );
    }
  }, {
    rateLimit: 'auth',
    csrf: false,
    ipBlocking: true,
  });
}

/**
 * DELETE /api/auth/booking-token
 * Logout and invalidate tokens
 */
export async function DELETE(request: NextRequest) {
  const response = NextResponse.json(
    {
      success: true,
      message: 'Succesvol uitgelogd',
    },
    { status: 200 }
  );

  // Clear all auth cookies
  response.cookies.delete('booking-token');
  response.cookies.delete('refresh-token');
  response.cookies.delete('session-id');

  return applySecurityHeaders(response);
}

/**
 * Create a standardized error response
 */
function createErrorResponse(
  message: string,
  status: number,
  code: string
): NextResponse {
  return NextResponse.json<BookingTokenResponse>(
    {
      success: false,
      error: {
        message,
        code,
      },
    },
    { status }
  );
}