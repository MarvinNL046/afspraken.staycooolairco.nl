/**
 * Secure API Route Handler
 * 
 * Wraps API route handlers with comprehensive security measures
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodSchema } from 'zod';
import { withSecurity } from './security.middleware';
import { withCORS } from './cors';
import { validateRequestBody } from './input-validation';
import { withAuth, AuthenticatedRequest } from './auth.middleware';
import { logger } from '@/lib/services/logging/logger';
import { monitoring } from '@/lib/services/monitoring/monitor';
import { securityMonitor, SecurityEventType } from '@/lib/services/security/security-monitor';
import { AppError, ErrorCode } from '@/lib/errors/types';

// Handler options
export interface SecureHandlerOptions<T = any> {
  // Authentication
  requireAuth?: boolean;
  
  // Validation
  schema?: ZodSchema<T>;
  
  // Rate limiting
  rateLimit?: 'api' | 'auth' | 'booking';
  
  // CORS
  cors?: boolean;
  allowedOrigins?: string[];
  
  // Security
  csrf?: boolean;
  ipBlocking?: boolean;
  
  // Monitoring
  trackPerformance?: boolean;
  
  // Timeout
  timeout?: number; // milliseconds
}

// Handler function types
type BasicHandler<T = any> = (
  request: NextRequest,
  data?: T
) => Promise<NextResponse>;

type AuthenticatedHandler<T = any> = (
  request: AuthenticatedRequest,
  data?: T
) => Promise<NextResponse>;

/**
 * Create secure API handler
 */
export function createSecureHandler<T = any>(
  options: SecureHandlerOptions<T> & { requireAuth: true },
  handler: AuthenticatedHandler<T>
): (request: NextRequest) => Promise<NextResponse>;

export function createSecureHandler<T = any>(
  options: SecureHandlerOptions<T> & { requireAuth?: false },
  handler: BasicHandler<T>
): (request: NextRequest) => Promise<NextResponse>;

export function createSecureHandler<T = any>(
  options: SecureHandlerOptions<T>,
  handler: BasicHandler<T> | AuthenticatedHandler<T>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    
    // Add request ID to headers
    const headers = new Headers();
    headers.set('X-Request-Id', requestId);
    
    try {
      // Apply security middleware
      return await withSecurity(request, async (securedRequest) => {
        // Apply CORS if enabled
        if (options.cors !== false) {
          return await withCORS(securedRequest, async (corsRequest) => {
            // Validate input if schema provided
            let validatedData: T | undefined;
            
            if (options.schema && corsRequest.method !== 'GET') {
              const { data, error } = await validateRequestBody(
                corsRequest,
                options.schema
              );
              
              if (error) {
                // Log validation failure
                securityMonitor.recordSecurityEvent(
                  SecurityEventType.VALIDATION_FAILED,
                  corsRequest,
                  { errors: error }
                );
                
                return error;
              }
              
              validatedData = data!;
              
              // Check for threat patterns
              const inputString = JSON.stringify(validatedData);
              const threats = securityMonitor.detectThreats(inputString);
              
              if (threats.detected) {
                // Log security threat
                const threatType = threats.threats[0].type;
                const eventType = {
                  SQL_INJECTION: SecurityEventType.SQL_INJECTION_ATTEMPT,
                  XSS: SecurityEventType.XSS_ATTEMPT,
                  PATH_TRAVERSAL: SecurityEventType.PATH_TRAVERSAL_ATTEMPT,
                }[threatType] || SecurityEventType.SUSPICIOUS_ACTIVITY;
                
                securityMonitor.recordSecurityEvent(
                  eventType,
                  corsRequest,
                  { threats: threats.threats }
                );
                
                return NextResponse.json(
                  {
                    error: {
                      message: 'Invalid input detected',
                      code: ErrorCode.VALIDATION_ERROR,
                    },
                  },
                  { status: 400, headers }
                );
              }
            }
            
            // Apply authentication if required
            if (options.requireAuth) {
              return await withAuth(corsRequest, async (authRequest) => {
                // Create timeout promise if specified
                let timeoutId: NodeJS.Timeout | undefined;
                const timeoutPromise = options.timeout
                  ? new Promise<NextResponse>((_, reject) => {
                      timeoutId = setTimeout(() => {
                        reject(new Error('Request timeout'));
                      }, options.timeout);
                    })
                  : null;
                
                try {
                  // Execute handler with timeout
                  const handlerPromise = (handler as AuthenticatedHandler<T>)(
                    authRequest,
                    validatedData
                  );
                  
                  const response = timeoutPromise
                    ? await Promise.race([handlerPromise, timeoutPromise])
                    : await handlerPromise;
                  
                  // Clear timeout
                  if (timeoutId) clearTimeout(timeoutId);
                  
                  // Track performance
                  if (options.trackPerformance !== false) {
                    const duration = Date.now() - startTime;
                    monitoring.recordHttpRequest(
                      corsRequest.nextUrl.pathname,
                      corsRequest.method,
                      response.status,
                      duration
                    );
                  }
                  
                  // Add security headers to response
                  response.headers.set('X-Request-Id', requestId);
                  response.headers.set('X-Content-Type-Options', 'nosniff');
                  response.headers.set('X-Frame-Options', 'DENY');
                  
                  return response;
                  
                } catch (error) {
                  // Clear timeout
                  if (timeoutId) clearTimeout(timeoutId);
                  
                  throw error;
                }
              });
            }
            
            // Execute handler without auth
            const response = await (handler as BasicHandler<T>)(
              corsRequest,
              validatedData
            );
            
            // Track performance
            if (options.trackPerformance !== false) {
              const duration = Date.now() - startTime;
              monitoring.recordHttpRequest(
                corsRequest.nextUrl.pathname,
                corsRequest.method,
                response.status,
                duration
              );
            }
            
            // Add security headers
            response.headers.set('X-Request-Id', requestId);
            response.headers.set('X-Content-Type-Options', 'nosniff');
            response.headers.set('X-Frame-Options', 'DENY');
            
            return response;
            
          }, options.allowedOrigins ? { origins: options.allowedOrigins } : undefined);
        }
        
        // No CORS, proceed directly
        const response = await handler(securedRequest as any, undefined);
        
        // Add security headers
        response.headers.set('X-Request-Id', requestId);
        response.headers.set('X-Content-Type-Options', 'nosniff');
        response.headers.set('X-Frame-Options', 'DENY');
        
        return response;
        
      }, {
        rateLimit: options.rateLimit || 'api',
        csrf: options.csrf !== false,
        ipBlocking: options.ipBlocking !== false,
      });
      
    } catch (error) {
      // Log error
      logger.error('Secure handler error', error as Error, {
        requestId,
        path: request.nextUrl.pathname,
        method: request.method,
      });
      
      // Track error
      monitoring.recordError(error as Error, {
        source: 'secure-handler',
        requestId,
        path: request.nextUrl.pathname,
      });
      
      // Return appropriate error response
      if (error instanceof AppError) {
        return NextResponse.json(
          {
            error: {
              message: error.message,
              code: error.code,
              requestId,
            },
          },
          { status: error.statusCode, headers }
        );
      }
      
      // Generic error response
      return NextResponse.json(
        {
          error: {
            message: 'Internal server error',
            code: ErrorCode.INTERNAL_ERROR,
            requestId,
          },
        },
        { status: 500, headers }
      );
    }
  };
}

/**
 * Security headers preset for different endpoint types
 */
export const SECURITY_PRESETS = {
  // Public API endpoints
  public: {
    requireAuth: false,
    cors: true,
    csrf: false,
    rateLimit: 'api' as const,
  },
  
  // Authenticated API endpoints
  authenticated: {
    requireAuth: true,
    cors: true,
    csrf: true,
    rateLimit: 'api' as const,
  },
  
  // Booking endpoints
  booking: {
    requireAuth: true,
    cors: true,
    csrf: true,
    rateLimit: 'booking' as const,
    timeout: 30000, // 30 seconds
  },
  
  // Admin endpoints
  admin: {
    requireAuth: true,
    cors: true,
    csrf: true,
    ipBlocking: true,
    rateLimit: 'auth' as const,
  },
  
  // Webhook endpoints
  webhook: {
    requireAuth: false,
    cors: false,
    csrf: false,
    ipBlocking: true,
    rateLimit: 'api' as const,
  },
} as const;