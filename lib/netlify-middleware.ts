import { HandlerEvent, HandlerResponse } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createErrorResponse } from './netlify-helpers';

// Types for middleware system
export interface HandlerContext {
  requestId: string;
  startTime: number;
  userId?: string;
  permissions?: string[];
  validatedData?: any;
  prisma?: PrismaClient;
}

export type MiddlewareHandler = (
  event: HandlerEvent,
  context: HandlerContext
) => Promise<HandlerContext | HandlerResponse>;

export type EnhancedHandler = (
  event: HandlerEvent,
  context: HandlerContext
) => Promise<HandlerResponse>;

/**
 * Request ID Generator Middleware
 * Generates unique request ID for tracking and logging
 */
export const requestIdMiddleware: MiddlewareHandler = async (event, context) => {
  context.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  context.startTime = Date.now();
  
  console.log(`[${context.requestId}] ${event.httpMethod} ${event.path} - Request started`);
  
  return context;
};

/**
 * CORS Middleware
 * Handles CORS preflight and adds appropriate headers
 */
export const corsMiddleware: MiddlewareHandler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': process.env.NODE_ENV === 'production' 
          ? process.env.ALLOWED_ORIGIN || '*' 
          : 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Max-Age': '86400', // 24 hours
      },
      body: '',
    };
  }
  
  return context;
};

/**
 * Rate Limiting Middleware
 * Simple in-memory rate limiting (for production, use Redis)
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export const rateLimitMiddleware = (
  windowMs: number = 60000, // 1 minute
  maxRequests: number = 100
): MiddlewareHandler => {
  return async (event, context) => {
    const clientId = event.headers['x-forwarded-for'] || 
                    event.headers['client-ip'] || 
                    'unknown';
    
    const now = Date.now();
    const rateLimitKey = `${clientId}:${Math.floor(now / windowMs)}`;
    
    const current = rateLimitStore.get(rateLimitKey) || { count: 0, resetTime: now + windowMs };
    
    if (current.count >= maxRequests) {
      console.warn(`[${context.requestId}] Rate limit exceeded for ${clientId}`);
      
      return createErrorResponse(429, 'Too Many Requests', {
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil((current.resetTime - now) / 1000),
      }, {
        'Retry-After': Math.ceil((current.resetTime - now) / 1000).toString(),
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': current.resetTime.toString(),
      });
    }
    
    // Update count
    current.count++;
    rateLimitStore.set(rateLimitKey, current);
    
    // Cleanup old entries (simple garbage collection)
    if (Math.random() < 0.01) { // 1% chance to cleanup
      for (const [key, value] of rateLimitStore.entries()) {
        if (value.resetTime < now) {
          rateLimitStore.delete(key);
        }
      }
    }
    
    return context;
  };
};

/**
 * API Key Authentication Middleware
 */
export const apiKeyAuthMiddleware = (
  requiredKeyEnv: string = 'ADMIN_API_KEY',
  allowedRoles: string[] = ['admin']
): MiddlewareHandler => {
  return async (event, context) => {
    const apiKey = event.headers['x-api-key'] || 
                  event.queryStringParameters?.apiKey ||
                  (event.body ? JSON.parse(event.body).apiKey : null);
    
    if (!apiKey) {
      return createErrorResponse(401, 'Authentication required', {
        message: 'API key is required. Provide it in X-API-Key header or request body.',
      });
    }
    
    const expectedKey = process.env[requiredKeyEnv];
    if (!expectedKey || apiKey !== expectedKey) {
      console.warn(`[${context.requestId}] Invalid API key attempt`);
      
      return createErrorResponse(401, 'Invalid API key', {
        message: 'The provided API key is invalid.',
      });
    }
    
    // Set permissions based on key
    context.permissions = allowedRoles;
    context.userId = 'api_user';
    
    console.log(`[${context.requestId}] Authenticated with roles: ${allowedRoles.join(', ')}`);
    
    return context;
  };
};

/**
 * Request Validation Middleware using Zod
 */
export const validationMiddleware = <T>(
  schema: z.ZodSchema<T>,
  source: 'body' | 'query' | 'params' = 'body'
): MiddlewareHandler => {
  return async (event, context) => {
    let dataToValidate: any;
    
    try {
      switch (source) {
        case 'body':
          if (!event.body) {
            return createErrorResponse(400, 'Request body is required');
          }
          dataToValidate = JSON.parse(event.body);
          break;
        case 'query':
          dataToValidate = event.queryStringParameters || {};
          break;
        case 'params':
          dataToValidate = (event as any).pathParameters || {};
          break;
      }
    } catch (parseError) {
      return createErrorResponse(400, 'Invalid JSON in request body', {
        details: 'Request body must be valid JSON'
      });
    }
    
    try {
      context.validatedData = schema.parse(dataToValidate);
      console.log(`[${context.requestId}] Request validation successful`);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        console.warn(`[${context.requestId}] Validation error:`, validationError.issues);
        
        return createErrorResponse(400, 'Validation error', {
          details: validationError.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
            received: 'received' in issue ? issue.received : undefined,
          }))
        });
      }
      
      throw validationError;
    }
    
    return context;
  };
};

/**
 * Database Connection Middleware
 * Manages Prisma client lifecycle
 */
export const databaseMiddleware: MiddlewareHandler = async (event, context) => {
  try {
    const prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      }
    });
    
    // Test connection
    await prisma.$connect();
    context.prisma = prisma;
    
    console.log(`[${context.requestId}] Database connection established`);
    
    return context;
  } catch (error) {
    console.error(`[${context.requestId}] Database connection failed:`, error);
    
    return createErrorResponse(503, 'Database connection failed', {
      message: 'Unable to connect to database. Please try again later.',
    });
  }
};

/**
 * Request Logging Middleware
 * Comprehensive request/response logging
 */
export const loggingMiddleware: MiddlewareHandler = async (event, context) => {
  const requestInfo = {
    requestId: context.requestId,
    method: event.httpMethod,
    path: event.path,
    queryString: event.queryStringParameters,
    userAgent: event.headers['user-agent'],
    ip: event.headers['x-forwarded-for'] || event.headers['client-ip'],
    contentType: event.headers['content-type'],
    contentLength: event.headers['content-length'],
    timestamp: new Date().toISOString(),
  };
  
  console.log(`[${context.requestId}] Request details:`, JSON.stringify(requestInfo, null, 2));
  
  return context;
};

/**
 * Error Handling Middleware
 * Catches and formats unhandled errors
 */
export const errorHandlingMiddleware = (handler: EnhancedHandler) => {
  return async (event: HandlerEvent, context?: HandlerContext): Promise<HandlerResponse> => {
    const ctx = context || { requestId: '', startTime: Date.now() };
    try {
      const response = await handler(event, ctx);
      
      // Log successful response
      console.log(`[${ctx.requestId}] Response: ${response.statusCode} - ${Date.now() - ctx.startTime}ms`);
      
      // Add request ID to response headers
      if (!response.headers) {
        response.headers = {};
      }
      response.headers['X-Request-ID'] = ctx.requestId;
      response.headers['X-Processing-Time'] = `${Date.now() - ctx.startTime}ms`;
      
      return response;
    } catch (error) {
      console.error(`[${ctx.requestId}] Unhandled error:`, error);
      
      // Log detailed error information
      const errorDetails = {
        requestId: ctx.requestId,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : 'UnknownError',
        },
        request: {
          method: event.httpMethod,
          path: event.path,
          headers: event.headers,
        },
        context: {
          userId: ctx.userId,
          permissions: ctx.permissions,
        },
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - ctx.startTime,
      };
      
      console.error('Error details:', JSON.stringify(errorDetails, null, 2));
      
      return createErrorResponse(500, 'Internal server error', {
        message: 'An unexpected error occurred. Please try again later.',
        requestId: ctx.requestId,
      }, {
        'X-Request-ID': ctx.requestId,
        'X-Processing-Time': `${Date.now() - ctx.startTime}ms`,
      });
    } finally {
      // Cleanup database connection
      if (ctx.prisma) {
        await ctx.prisma.$disconnect();
        console.log(`[${ctx.requestId}] Database connection closed`);
      }
    }
  };
};

/**
 * Health Check Middleware
 * Performs basic system health checks
 */
export const healthCheckMiddleware: MiddlewareHandler = async (event, context) => {
  if (event.path === '/health' || event.path?.endsWith('/health')) {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      database: context.prisma ? 'connected' : 'not_connected',
    };
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(healthData),
    };
  }
  
  return context;
};

/**
 * Compose multiple middleware functions
 */
export function composeMiddleware(...middlewares: MiddlewareHandler[]): MiddlewareHandler[] {
  return middlewares;
}

/**
 * Create an enhanced handler with middleware pipeline
 */
export function createEnhancedHandler(
  handler: EnhancedHandler,
  middlewares: MiddlewareHandler[] = []
): (event: HandlerEvent, context?: any) => Promise<HandlerResponse> {
  return errorHandlingMiddleware(async (event: HandlerEvent, context: HandlerContext = { requestId: '', startTime: Date.now() }) => {
    // Run through middleware pipeline
    for (const middleware of middlewares) {
      const result = await middleware(event, context);
      
      // If middleware returns a response, return it immediately
      if ('statusCode' in result) {
        return result as HandlerResponse;
      }
      
      // Otherwise, update context and continue
      Object.assign(context, result);
    }
    
    // Run the main handler
    return await handler(event, context);
  });
}

/**
 * Default middleware stack for most functions
 */
export const defaultMiddlewareStack = [
  requestIdMiddleware,
  corsMiddleware,
  loggingMiddleware,
  rateLimitMiddleware(),
  healthCheckMiddleware,
];

/**
 * Authenticated middleware stack (requires API key)
 */
export const authenticatedMiddlewareStack = [
  ...defaultMiddlewareStack,
  apiKeyAuthMiddleware(),
  databaseMiddleware,
];

/**
 * Public middleware stack (no authentication required)
 */
export const publicMiddlewareStack = [
  ...defaultMiddlewareStack,
  databaseMiddleware,
];

/**
 * Validation helper for common schemas
 */
export const commonSchemas = {
  // Date validation
  dateString: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  
  // Time validation
  timeString: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  
  // Dutch postal code
  dutchPostalCode: z.string().regex(/^\d{4}\s?[A-Z]{2}$/i, 'Invalid Dutch postal code'),
  
  // Dutch phone number
  dutchPhoneNumber: z.string().regex(/^(\+31|0)[\s-]?[1-9][\s-]?(\d[\s-]?){8}$/, 'Invalid Dutch phone number'),
  
  // Email
  email: z.string().email().max(320).toLowerCase(),
  
  // Coordinates
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  
  // Service types
  serviceType: z.enum(['installation', 'maintenance', 'repair', 'inspection']),
  
  // Customer types
  customerType: z.enum(['residential', 'business']),
  
  // Appointment status
  appointmentStatus: z.enum(['gepland', 'bevestigd', 'geannuleerd', 'afgerond', 'niet_verschenen']),
  
  // Priority levels
  priority: z.number().min(0).max(10),
  
  // Urgency levels
  urgency: z.enum(['low', 'normal', 'high', 'critical']),
};

/**
 * Helper function to create validation middleware with common schemas
 */
export function createValidationMiddleware<T>(
  schema: z.ZodSchema<T>,
  source: 'body' | 'query' | 'params' = 'body'
) {
  return validationMiddleware(schema, source);
}

/**
 * Performance monitoring middleware
 */
export const performanceMiddleware: MiddlewareHandler = async (event, context) => {
  // Add performance markers
  context.performanceMarkers = {
    requestStart: Date.now(),
    middlewareStart: Date.now(),
  };
  
  return context;
};

/**
 * Security headers middleware
 */
export const securityHeadersMiddleware: MiddlewareHandler = async (event, context) => {
  // Security headers will be added in the error handling middleware
  return context;
};

// Extend the HandlerContext interface to include performance markers
declare module './netlify-middleware' {
  interface HandlerContext {
    performanceMarkers?: {
      requestStart: number;
      middlewareStart: number;
      [key: string]: number;
    };
  }
}