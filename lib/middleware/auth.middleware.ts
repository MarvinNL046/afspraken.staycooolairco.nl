/**
 * Authentication Middleware
 * 
 * Provides JWT authentication, security headers, and request validation
 * for the StayCool appointment booking system.
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtService, JWTError, BookingTokenPayload } from '@/lib/services/auth/jwt.service';
import { securityConfig } from '@/lib/config/security';

// Extended request type with auth context
export interface AuthenticatedRequest extends NextRequest {
  auth?: {
    leadId: string;
    email: string;
    sessionId: string;
    token: BookingTokenPayload;
  };
}

// Security headers to apply
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
};

// Content Security Policy
const getCSP = () => {
  const { contentSecurityPolicy } = securityConfig.headers;
  const directives = Object.entries(contentSecurityPolicy.directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
  return directives;
};

/**
 * Apply security headers to response
 */
export function applySecurityHeaders(response: NextResponse): NextResponse {
  // Apply standard security headers
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Apply CSP
  response.headers.set('Content-Security-Policy', getCSP());

  // Remove sensitive headers
  response.headers.delete('X-Powered-By');
  response.headers.delete('Server');

  return response;
}

/**
 * Extract JWT token from request
 */
function extractToken(request: NextRequest): string | null {
  // Check Authorization header
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check cookie (for same-origin requests)
  const cookieToken = request.cookies.get('booking-token');
  if (cookieToken) {
    return cookieToken.value;
  }

  return null;
}

/**
 * Authentication middleware for protected routes
 */
export async function withAuth(
  request: NextRequest,
  handler: (req: AuthenticatedRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    // Extract token
    const token = extractToken(request);
    if (!token) {
      return createErrorResponse('No authentication token provided', 401);
    }

    // Verify token
    const payload = await jwtService.verifyBookingToken(token);

    // Add auth context to request
    const authenticatedRequest = request as AuthenticatedRequest;
    authenticatedRequest.auth = {
      leadId: payload.leadId,
      email: payload.email,
      sessionId: payload.sessionId,
      token: payload,
    };

    // Check if token is expiring soon
    if (jwtService.isTokenExpiringSoon(token)) {
      // Add refresh hint to response
      const response = await handler(authenticatedRequest);
      response.headers.set('X-Token-Expires-Soon', 'true');
      return applySecurityHeaders(response);
    }

    // Process request
    const response = await handler(authenticatedRequest);
    return applySecurityHeaders(response);

  } catch (error) {
    if (error instanceof JWTError) {
      switch (error.code) {
        case 'EXPIRED_TOKEN':
          return createErrorResponse('Token has expired', 401, 'TOKEN_EXPIRED');
        case 'INVALID_SIGNATURE':
          return createErrorResponse('Invalid token signature', 401, 'INVALID_TOKEN');
        case 'INVALID_AUDIENCE':
        case 'INVALID_ISSUER':
          return createErrorResponse('Token validation failed', 401, 'INVALID_TOKEN');
        default:
          return createErrorResponse('Authentication failed', 401, 'AUTH_FAILED');
      }
    }

    console.error('Auth middleware error:', error);
    return createErrorResponse('Authentication error', 500, 'SERVER_ERROR');
  }
}

/**
 * Optional authentication middleware (auth not required but parsed if present)
 */
export async function withOptionalAuth(
  request: NextRequest,
  handler: (req: AuthenticatedRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    // Extract token if present
    const token = extractToken(request);
    if (token) {
      try {
        const payload = await jwtService.verifyBookingToken(token);
        const authenticatedRequest = request as AuthenticatedRequest;
        authenticatedRequest.auth = {
          leadId: payload.leadId,
          email: payload.email,
          sessionId: payload.sessionId,
          token: payload,
        };
      } catch {
        // Invalid token - continue without auth
      }
    }

    // Process request
    const response = await handler(request as AuthenticatedRequest);
    return applySecurityHeaders(response);

  } catch (error) {
    console.error('Optional auth middleware error:', error);
    return createErrorResponse('Server error', 500, 'SERVER_ERROR');
  }
}

/**
 * Create a standardized error response
 */
function createErrorResponse(
  message: string,
  status: number,
  code?: string
): NextResponse {
  const response = NextResponse.json(
    {
      error: {
        message,
        code: code || 'ERROR',
        timestamp: new Date().toISOString(),
      },
    },
    { status }
  );

  return applySecurityHeaders(response);
}

/**
 * Validate request origin for CORS
 */
export function validateOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // Same-origin requests

  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'https://afspraken.staycoolairco.nl',
    'https://www.staycoolairco.nl',
  ].filter(Boolean);

  return allowedOrigins.includes(origin);
}

/**
 * API key validation for server-to-server requests
 */
export function validateApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey) return false;

  // In production, validate against stored API keys
  const validApiKey = process.env.INTERNAL_API_KEY;
  return apiKey === validApiKey;
}