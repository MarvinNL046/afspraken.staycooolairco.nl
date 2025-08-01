import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/serverless';
import { RateLimiter } from './rate-limiter';
import { logger } from './logger';
import { validateApiKey } from './auth';

// Initialize Sentry
Sentry.AWSLambda.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_ENV || 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Rate limiter instance
const rateLimiter = new RateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
});

interface FunctionOptions {
  requireAuth?: boolean;
  rateLimit?: boolean;
  rateLimitMax?: number;
  allowedMethods?: string[];
  cors?: boolean;
  corsOrigins?: string[];
  timeout?: number;
  validateBody?: (body: any) => { valid: boolean; error?: string };
}

interface FunctionContext extends HandlerContext {
  supabase: typeof supabase;
  logger: typeof logger;
  userId?: string;
  requestId: string;
}

type FunctionHandler = (
  event: HandlerEvent,
  context: FunctionContext
) => Promise<{ statusCode: number; body: string; headers?: Record<string, string> }>;

/**
 * Production-ready function wrapper with error handling, monitoring, and security
 */
export function createFunction(
  handler: FunctionHandler,
  options: FunctionOptions = {}
): Handler {
  const {
    requireAuth = false,
    rateLimit = true,
    rateLimitMax,
    allowedMethods = ['GET', 'POST'],
    cors = true,
    corsOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(',') || ['https://staycoolairco.nl'],
    timeout = 10000,
    validateBody,
  } = options;

  return async (event: HandlerEvent, context: HandlerContext) => {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    
    // Enhanced context
    const enhancedContext: FunctionContext = {
      ...context,
      supabase,
      logger: logger.child({ requestId, function: context.functionName }),
      requestId,
    };

    // Log request
    enhancedContext.logger.info('Function invoked', {
      method: event.httpMethod,
      path: event.path,
      headers: {
        ...event.headers,
        authorization: event.headers.authorization ? '[REDACTED]' : undefined,
      },
    });

    try {
      // CORS headers
      const headers: Record<string, string> = {};
      
      if (cors) {
        const origin = event.headers.origin || event.headers.Origin || '';
        const isAllowedOrigin = corsOrigins.some(allowed => {
          if (allowed.endsWith('*')) {
            return origin.startsWith(allowed.slice(0, -1));
          }
          return origin === allowed;
        });

        if (isAllowedOrigin) {
          headers['Access-Control-Allow-Origin'] = origin;
          headers['Access-Control-Allow-Credentials'] = 'true';
        }
        
        headers['Access-Control-Allow-Methods'] = allowedMethods.join(', ');
        headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Request-ID';
        headers['Access-Control-Max-Age'] = '86400';
      }

      // Handle preflight requests
      if (event.httpMethod === 'OPTIONS') {
        return {
          statusCode: 204,
          headers,
          body: '',
        };
      }

      // Method validation
      if (!allowedMethods.includes(event.httpMethod)) {
        return {
          statusCode: 405,
          headers: {
            ...headers,
            'Allow': allowedMethods.join(', '),
          },
          body: JSON.stringify({
            error: 'Method not allowed',
            message: `This endpoint only accepts ${allowedMethods.join(', ')} requests`,
          }),
        };
      }

      // Rate limiting
      if (rateLimit) {
        const clientId = event.headers['x-forwarded-for'] || 
                        event.headers['x-real-ip'] || 
                        'unknown';
        
        const limited = await rateLimiter.isRateLimited(clientId, rateLimitMax);
        if (limited) {
          enhancedContext.logger.warn('Rate limit exceeded', { clientId });
          return {
            statusCode: 429,
            headers: {
              ...headers,
              'Retry-After': '60',
              'X-RateLimit-Limit': String(rateLimitMax || 100),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Date.now() + 60000),
            },
            body: JSON.stringify({
              error: 'Too many requests',
              message: 'Rate limit exceeded. Please try again later.',
            }),
          };
        }
      }

      // Authentication
      if (requireAuth) {
        const authHeader = event.headers.authorization || event.headers.Authorization;
        
        if (!authHeader) {
          return {
            statusCode: 401,
            headers: {
              ...headers,
              'WWW-Authenticate': 'Bearer',
            },
            body: JSON.stringify({
              error: 'Unauthorized',
              message: 'Authentication required',
            }),
          };
        }

        try {
          const token = authHeader.replace('Bearer ', '');
          const isValid = validateApiKey(token);
          
          if (!isValid) {
            return {
              statusCode: 401,
              headers: {
                ...headers,
                'WWW-Authenticate': 'Bearer error="invalid_token"',
              },
              body: JSON.stringify({
                error: 'Unauthorized',
                message: 'Invalid or expired token',
              }),
            };
          }
        } catch (error) {
          enhancedContext.logger.error('Authentication error', { error });
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({
              error: 'Unauthorized',
              message: 'Authentication failed',
            }),
          };
        }
      }

      // Body parsing and validation
      let body: any = {};
      if (event.body && ['POST', 'PUT', 'PATCH'].includes(event.httpMethod)) {
        try {
          body = JSON.parse(event.body);
          
          // Custom body validation
          if (validateBody) {
            const validation = validateBody(body);
            if (!validation.valid) {
              return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                  error: 'Bad request',
                  message: validation.error || 'Invalid request body',
                }),
              };
            }
          }
        } catch (error) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              error: 'Bad request',
              message: 'Invalid JSON in request body',
            }),
          };
        }
      }

      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Function timeout')), timeout);
      });

      // Execute handler with timeout
      const result = await Promise.race([
        handler({ ...event, body }, enhancedContext),
        timeoutPromise,
      ]);

      // Add standard headers
      result.headers = {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        'X-Response-Time': String(Date.now() - startTime),
        ...headers,
        ...result.headers,
      };

      // Log successful response
      enhancedContext.logger.info('Function completed', {
        statusCode: result.statusCode,
        responseTime: Date.now() - startTime,
      });

      return result;

    } catch (error) {
      // Error handling
      const errorId = crypto.randomUUID();
      
      enhancedContext.logger.error('Function error', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        } : error,
        errorId,
      });

      // Report to Sentry
      Sentry.captureException(error, {
        tags: {
          function: context.functionName,
          errorId,
        },
        extra: {
          event: {
            ...event,
            body: event.body ? '[REDACTED]' : undefined,
          },
        },
      });

      // Determine status code
      let statusCode = 500;
      let message = 'Internal server error';
      
      if (error instanceof Error) {
        if (error.message === 'Function timeout') {
          statusCode = 504;
          message = 'Function timeout';
        } else if (error.message.includes('Not found')) {
          statusCode = 404;
          message = error.message;
        } else if (error.message.includes('Bad request')) {
          statusCode = 400;
          message = error.message;
        }
      }

      return {
        statusCode,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
          'X-Error-ID': errorId,
        },
        body: JSON.stringify({
          error: 'Server error',
          message: process.env.NODE_ENV === 'production' ? message : error instanceof Error ? error.message : 'Unknown error',
          errorId,
          timestamp: new Date().toISOString(),
        }),
      };
    }
  };
}

// Health check function
export const healthCheck = createFunction(
  async (event, context) => {
    const checks = {
      function: 'ok',
      database: 'unknown',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    };

    // Check database connection
    try {
      const { error } = await context.supabase
        .from('_health_check')
        .select('1')
        .limit(1);
      
      checks.database = error ? 'error' : 'ok';
    } catch {
      checks.database = 'error';
    }

    const allHealthy = Object.values(checks).every(v => v === 'ok' || typeof v === 'string');

    return {
      statusCode: allHealthy ? 200 : 503,
      body: JSON.stringify(checks),
    };
  },
  {
    requireAuth: false,
    rateLimit: false,
    allowedMethods: ['GET'],
  }
);