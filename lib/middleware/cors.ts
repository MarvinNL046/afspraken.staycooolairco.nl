/**
 * CORS Configuration Module
 * 
 * Implements secure Cross-Origin Resource Sharing (CORS) policies
 * with environment-specific configuration and security best practices
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/services/logging/logger';

// Environment
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

// CORS Configuration
export interface CORSConfig {
  origins: string[];
  credentials: boolean;
  maxAge: number;
  allowedMethods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
}

// Default CORS configurations
const PRODUCTION_CORS: CORSConfig = {
  origins: [
    'https://staycoolairco.nl',
    'https://www.staycoolairco.nl',
    'https://booking.staycoolairco.nl',
    'https://admin.staycoolairco.nl',
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-CSRF-Token',
    'X-Booking-Token',
  ],
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-Request-Id',
  ],
};

const DEVELOPMENT_CORS: CORSConfig = {
  ...PRODUCTION_CORS,
  origins: [
    ...PRODUCTION_CORS.origins,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8888',
    'http://127.0.0.1:3000',
  ],
};

// Get active CORS configuration
export function getCORSConfig(): CORSConfig {
  // Allow environment variable override
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (envOrigins) {
    const customOrigins = envOrigins.split(',').map(origin => origin.trim());
    return {
      ...(isProduction ? PRODUCTION_CORS : DEVELOPMENT_CORS),
      origins: customOrigins,
    };
  }
  
  return isProduction ? PRODUCTION_CORS : DEVELOPMENT_CORS;
}

/**
 * Check if origin is allowed
 */
export function isOriginAllowed(origin: string | null, config: CORSConfig): boolean {
  if (!origin) return false;
  
  // Check exact match
  if (config.origins.includes(origin)) {
    return true;
  }
  
  // Check wildcard patterns
  for (const allowedOrigin of config.origins) {
    if (allowedOrigin.includes('*')) {
      const pattern = allowedOrigin
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      if (regex.test(origin)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Apply CORS headers to response
 */
export function applyCORSHeaders(
  request: NextRequest,
  response: NextResponse,
  config: CORSConfig = getCORSConfig()
): void {
  const origin = request.headers.get('origin');
  
  // Check if origin is allowed
  if (origin && isOriginAllowed(origin, config)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  } else if (!isProduction && !origin) {
    // In development, allow requests without origin (e.g., Postman)
    response.headers.set('Access-Control-Allow-Origin', '*');
  }
  
  // Always set these headers
  if (config.credentials) {
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  
  // Preflight request headers
  if (request.method === 'OPTIONS') {
    response.headers.set(
      'Access-Control-Allow-Methods',
      config.allowedMethods.join(', ')
    );
    response.headers.set(
      'Access-Control-Allow-Headers',
      config.allowedHeaders.join(', ')
    );
    response.headers.set(
      'Access-Control-Max-Age',
      config.maxAge.toString()
    );
  }
  
  // Exposed headers
  if (config.exposedHeaders.length > 0) {
    response.headers.set(
      'Access-Control-Expose-Headers',
      config.exposedHeaders.join(', ')
    );
  }
}

/**
 * Handle CORS preflight request
 */
export function handleCORSPreflight(
  request: NextRequest,
  config: CORSConfig = getCORSConfig()
): NextResponse | null {
  if (request.method !== 'OPTIONS') {
    return null;
  }
  
  const origin = request.headers.get('origin');
  const requestMethod = request.headers.get('access-control-request-method');
  const requestHeaders = request.headers.get('access-control-request-headers');
  
  // Validate preflight request
  if (!origin || !requestMethod) {
    return new NextResponse('Bad Request', { status: 400 });
  }
  
  // Check if origin is allowed
  if (!isOriginAllowed(origin, config)) {
    logger.warn('CORS preflight rejected - invalid origin', {
      origin,
      allowedOrigins: config.origins,
    });
    return new NextResponse('Forbidden', { status: 403 });
  }
  
  // Check if method is allowed
  if (!config.allowedMethods.includes(requestMethod.toUpperCase())) {
    logger.warn('CORS preflight rejected - invalid method', {
      method: requestMethod,
      allowedMethods: config.allowedMethods,
    });
    return new NextResponse('Method Not Allowed', { status: 405 });
  }
  
  // Check if headers are allowed
  if (requestHeaders) {
    const headers = requestHeaders.split(',').map(h => h.trim());
    const invalidHeaders = headers.filter(
      h => !config.allowedHeaders.some(
        allowed => allowed.toLowerCase() === h.toLowerCase()
      )
    );
    
    if (invalidHeaders.length > 0) {
      logger.warn('CORS preflight rejected - invalid headers', {
        invalidHeaders,
        allowedHeaders: config.allowedHeaders,
      });
      return new NextResponse('Forbidden', { status: 403 });
    }
  }
  
  // Create successful preflight response
  const response = new NextResponse(null, { status: 204 });
  applyCORSHeaders(request, response, config);
  
  return response;
}

/**
 * CORS middleware
 */
export async function withCORS(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<NextResponse>,
  customConfig?: Partial<CORSConfig>
): Promise<NextResponse> {
  const config = customConfig
    ? { ...getCORSConfig(), ...customConfig }
    : getCORSConfig();
  
  // Handle preflight
  const preflightResponse = handleCORSPreflight(request, config);
  if (preflightResponse) {
    return preflightResponse;
  }
  
  // Check origin for non-preflight requests
  const origin = request.headers.get('origin');
  if (origin && !isOriginAllowed(origin, config)) {
    logger.warn('CORS request rejected - invalid origin', {
      origin,
      path: request.nextUrl.pathname,
      method: request.method,
    });
    
    return new NextResponse(
      JSON.stringify({
        error: {
          message: 'Cross-origin request blocked',
          code: 'CORS_ERROR',
        },
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
  
  // Process request
  const response = await handler(request);
  
  // Apply CORS headers
  applyCORSHeaders(request, response, config);
  
  return response;
}

/**
 * Create CORS configuration for specific endpoints
 */
export function createEndpointCORS(
  allowedOrigins: string[],
  options: Partial<CORSConfig> = {}
): CORSConfig {
  return {
    ...getCORSConfig(),
    origins: allowedOrigins,
    ...options,
  };
}

/**
 * Strict CORS for sensitive endpoints
 */
export const STRICT_CORS: CORSConfig = {
  origins: isProduction
    ? ['https://staycoolairco.nl', 'https://www.staycoolairco.nl']
    : ['http://localhost:3000'],
  credentials: true,
  maxAge: 3600, // 1 hour
  allowedMethods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: [],
};

/**
 * Public API CORS (more permissive)
 */
export const PUBLIC_API_CORS: CORSConfig = {
  origins: ['*'], // Allow all origins for public API
  credentials: false,
  maxAge: 86400, // 24 hours
  allowedMethods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
};