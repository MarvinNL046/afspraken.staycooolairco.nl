/**
 * Next.js Middleware - Production Security Hardening
 * 
 * Implements comprehensive security measures:
 * - HTTPS enforcement
 * - Security headers (CSP, HSTS, etc.)
 * - CORS configuration
 * - Rate limiting
 * - Input validation
 * - Request sanitization
 * - Security monitoring
 */

import { NextRequest, NextResponse } from 'next/server';
import { securityConfig } from '@/lib/config/security';

// Environment check
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://staycoolairco.nl',
  'https://www.staycoolairco.nl',
  'https://booking.staycoolairco.nl',
  ...(isDevelopment ? ['http://localhost:3000', 'http://localhost:8888'] : []),
];

// Security headers configuration
const SECURITY_HEADERS: Record<string, string> = {
  // Strict Transport Security
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  
  // Content Security Policy
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://maps.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://api.staycoolairco.nl https://maps.googleapis.com https://www.google-analytics.com wss://",
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'self' https://maps.google.com",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join('; '),
  
  // Other security headers
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
  
  // Remove server information
  'X-Powered-By': '',
  'Server': '',
};

// Rate limiting configuration per path
const RATE_LIMIT_PATHS: Record<string, keyof typeof securityConfig.rateLimit> = {
  '/api/bookings': 'booking',
  '/api/appointments': 'booking',
  '/api/auth': 'auth',
  '/api': 'api',
};

// Paths that bypass security checks (static assets, etc.)
const BYPASS_PATHS = [
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/images',
  '/fonts',
];

/**
 * Check if request should bypass security middleware
 */
function shouldBypass(pathname: string): boolean {
  return BYPASS_PATHS.some(path => pathname.startsWith(path));
}

/**
 * Enforce HTTPS in production
 */
function enforceHTTPS(request: NextRequest): NextResponse | null {
  if (!isProduction) return null;
  
  const proto = request.headers.get('x-forwarded-proto');
  if (proto && proto !== 'https') {
    const httpsUrl = new URL(request.url);
    httpsUrl.protocol = 'https:';
    return NextResponse.redirect(httpsUrl.toString(), 301);
  }
  
  return null;
}

/**
 * Configure CORS
 */
function configureCORS(request: NextRequest, response: NextResponse): void {
  const origin = request.headers.get('origin');
  
  // Check if origin is allowed
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  
  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token');
    response.headers.set('Access-Control-Max-Age', '86400'); // 24 hours
  }
}

/**
 * Apply security headers
 */
function applySecurityHeaders(response: NextResponse): void {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    if (value) {
      response.headers.set(key, value);
    } else {
      response.headers.delete(key);
    }
  });
}

/**
 * Get rate limit key for path
 */
function getRateLimitKey(pathname: string): keyof typeof securityConfig.rateLimit {
  for (const [path, key] of Object.entries(RATE_LIMIT_PATHS)) {
    if (pathname.startsWith(path)) {
      return key;
    }
  }
  return 'api';
}

/**
 * Log security events (simplified for Edge Runtime)
 */
function logSecurityEvent(
  event: string,
  request: NextRequest,
  details: Record<string, any> = {}
): void {
  // In Edge Runtime, we'll use console for now
  // In production, this could be sent to an external logging service
  if (process.env.NODE_ENV !== 'production') {
    console.log('Security Event:', {
      event,
      method: request.method,
      path: request.nextUrl.pathname,
      ...details,
    });
  }
}

/**
 * Validate request headers
 */
function validateHeaders(request: NextRequest): NextResponse | null {
  // Check for suspicious headers
  const suspiciousHeaders = [
    'x-forwarded-host',
    'x-original-url',
    'x-rewrite-url',
  ];
  
  for (const header of suspiciousHeaders) {
    if (request.headers.has(header)) {
      logSecurityEvent('suspicious_header', request, { header });
      return NextResponse.json(
        { error: 'Invalid request' },
        { status: 400 }
      );
    }
  }
  
  // Validate content-type for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const contentType = request.headers.get('content-type');
    if (!contentType || (!contentType.includes('application/json') && !contentType.includes('multipart/form-data'))) {
      return NextResponse.json(
        { error: 'Invalid content type' },
        { status: 415 }
      );
    }
  }
  
  return null;
}

/**
 * Main middleware function
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  
  // Skip security for bypass paths
  if (shouldBypass(pathname)) {
    return NextResponse.next();
  }
  
  // Start timing
  const startTime = Date.now();
  
  try {
    // 1. Enforce HTTPS
    const httpsRedirect = enforceHTTPS(request);
    if (httpsRedirect) {
      return httpsRedirect;
    }
    
    // 2. Validate headers
    const headerValidation = validateHeaders(request);
    if (headerValidation) {
      return headerValidation;
    }
    
    // 3. Handle CORS preflight
    if (request.method === 'OPTIONS') {
      const response = new NextResponse(null, { status: 204 });
      configureCORS(request, response);
      applySecurityHeaders(response);
      return response;
    }
    
    // 4. Import and apply rate limiting
    if (pathname.startsWith('/api')) {
      const { withSecurity } = await import('@/lib/middleware/security.middleware');
      const rateLimitKey = getRateLimitKey(pathname);
      
      const response = await withSecurity(
        request,
        async (req) => {
          // Continue to the actual API handler
          return NextResponse.next();
        },
        {
          rateLimit: rateLimitKey,
          csrf: true,
          ipBlocking: true,
        }
      );
      
      // Apply security headers and CORS
      configureCORS(request, response);
      applySecurityHeaders(response);
      
      // Log request timing
      const duration = Date.now() - startTime;
      if (duration > 1000) {
        logSecurityEvent('slow_request', request, { duration });
      }
      
      return response;
    }
    
    // 5. For non-API routes, continue with security headers
    const response = NextResponse.next();
    configureCORS(request, response);
    applySecurityHeaders(response);
    
    return response;
    
  } catch (error) {
    // Log security errors
    logSecurityEvent('middleware_error', request, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    // Return generic error response
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Configure which paths the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};