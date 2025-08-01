/**
 * Error Handling Middleware
 * Provides centralized error handling for API routes and Next.js
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { 
  AppError, 
  ValidationError, 
  normalizeError,
  isOperationalError,
  ErrorCode,
  ErrorSeverity
} from '@/lib/errors/types';
import { logger } from '@/lib/services/logging/logger';
import { monitoring } from '@/lib/services/monitoring/monitor';

// Error response format
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    requestId?: string;
    timestamp: string;
  };
}

/**
 * Format error response
 */
function formatErrorResponse(
  error: AppError,
  requestId?: string
): ErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        context: error.context,
      } : undefined,
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Handle Zod validation errors
 */
function handleZodError(error: ZodError): ValidationError {
  const errors = error.issues.map(issue => ({
    field: issue.path.join('.'),
    message: issue.message,
    value: issue.code,
  }));

  return new ValidationError(
    'Validation failed',
    errors,
    { originalError: error }
  );
}

/**
 * Error handler for API routes
 */
export function handleApiError(
  error: unknown,
  request?: NextRequest
): NextResponse {
  // Generate request ID
  const requestId = request?.headers.get('x-request-id') || 
    `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Normalize the error
  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = handleZodError(error);
  } else {
    appError = normalizeError(error);
  }

  // Add request context
  appError.metadata.requestId = requestId;
  appError.metadata.path = request?.nextUrl.pathname;
  appError.metadata.method = request?.method;

  // Log the error
  const logContext = {
    requestId,
    path: request?.nextUrl.pathname,
    method: request?.method,
    query: Object.fromEntries(request?.nextUrl.searchParams || []),
    headers: process.env.NODE_ENV === 'development' 
      ? Object.fromEntries(request?.headers || [])
      : undefined,
  };

  if (appError.severity === ErrorSeverity.CRITICAL) {
    logger.fatal(appError.message, appError, logContext);
  } else if (appError.statusCode >= 500) {
    logger.error(appError.message, appError, logContext);
  } else {
    logger.warn(appError.message, { ...logContext, error: appError });
  }

  // Record in monitoring
  monitoring.recordError(appError, {
    source: 'api',
    requestId,
    path: request?.nextUrl.pathname,
  });

  // Create response
  const response = NextResponse.json(
    formatErrorResponse(appError, requestId),
    { status: appError.statusCode }
  );

  // Add error headers
  response.headers.set('X-Request-ID', requestId);
  
  if (appError.code === ErrorCode.RATE_LIMIT_EXCEEDED && appError.context.retryAfter) {
    response.headers.set('Retry-After', String(appError.context.retryAfter));
  }

  return response;
}

/**
 * Error handler middleware wrapper for API routes
 */
export function withErrorHandler<T extends any[], R>(
  handler: (...args: T) => Promise<R>
): (...args: T) => Promise<R | NextResponse> {
  return async (...args: T) => {
    try {
      const startTime = Date.now();
      const result = await handler(...args);
      
      // Log successful request if it's an API route
      const request = args.find(arg => arg instanceof NextRequest) as NextRequest | undefined;
      if (request) {
        const duration = Date.now() - startTime;
        logger.logHttpRequest(
          request.method,
          request.nextUrl.pathname,
          200, // Assuming success
          duration
        );
        
        monitoring.recordHttpRequest(
          request.method,
          request.nextUrl.pathname,
          200,
          duration
        );
      }
      
      return result;
    } catch (error) {
      const request = args.find(arg => arg instanceof NextRequest) as NextRequest | undefined;
      return handleApiError(error, request);
    }
  };
}

/**
 * Async error wrapper for non-API route functions
 */
export function withAsyncErrorHandler<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  context?: Record<string, any>
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (error) {
      const appError = normalizeError(error);
      
      logger.error('Async operation failed', appError, {
        ...context,
        function: fn.name || 'anonymous',
      });
      
      monitoring.recordError(appError, {
        source: 'async-function',
        ...context,
      });
      
      throw appError;
    }
  };
}

/**
 * Database operation error handler
 */
export function withDatabaseErrorHandler<T extends any[], R>(
  operation: string,
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    const startTime = Date.now();
    let success = false;
    
    try {
      const result = await fn(...args);
      success = true;
      return result;
    } catch (error) {
      // Check for specific database errors
      if (error instanceof Error) {
        if (error.message.includes('P2002')) {
          throw new AppError(
            'A record with this value already exists',
            ErrorCode.ALREADY_EXISTS,
            409,
            ErrorSeverity.LOW,
            { operation, originalError: error }
          );
        }
        
        if (error.message.includes('P2025')) {
          throw new AppError(
            'Record not found',
            ErrorCode.NOT_FOUND,
            404,
            ErrorSeverity.LOW,
            { operation, originalError: error }
          );
        }
      }
      
      throw new AppError(
        'Database operation failed',
        ErrorCode.DATABASE_ERROR,
        500,
        ErrorSeverity.HIGH,
        { operation, originalError: error }
      );
    } finally {
      const duration = Date.now() - startTime;
      logger.logDatabaseQuery(operation, duration, success);
      monitoring.recordDatabaseQuery(operation, duration, success);
    }
  };
}

/**
 * External service error handler
 */
export function withExternalServiceErrorHandler<T extends any[], R>(
  service: string,
  operation: string,
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    const startTime = Date.now();
    let success = false;
    
    try {
      const result = await fn(...args);
      success = true;
      return result;
    } catch (error) {
      // Map external service errors to our error types
      const appError = new AppError(
        `${service} operation failed: ${operation}`,
        ErrorCode.EXTERNAL_SERVICE_ERROR,
        503,
        ErrorSeverity.HIGH,
        { 
          service, 
          operation, 
          originalError: error,
          retryable: true,
          retryAfter: 60,
        }
      );
      
      throw appError;
    } finally {
      const duration = Date.now() - startTime;
      logger.logExternalCall(service, operation, duration, success);
      monitoring.recordHttpRequest(
        'EXTERNAL',
        `${service}/${operation}`,
        success ? 200 : 503,
        duration
      );
    }
  };
}

/**
 * Graceful degradation wrapper
 */
export function withGracefulDegradation<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  fallback: R | ((...args: T) => R | Promise<R>),
  options?: {
    shouldDegrade?: (error: Error) => boolean;
    onDegrade?: (error: Error) => void;
  }
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (error) {
      const appError = normalizeError(error);
      
      // Check if we should degrade
      const shouldDegrade = options?.shouldDegrade 
        ? options.shouldDegrade(appError)
        : appError.severity !== ErrorSeverity.CRITICAL;
      
      if (!shouldDegrade) {
        throw appError;
      }
      
      // Log degradation
      logger.warn('Service degraded to fallback', {
        error: appError,
        function: fn.name || 'anonymous',
        degraded: true,
      });
      
      // Call degradation callback
      if (options?.onDegrade) {
        options.onDegrade(appError);
      }
      
      // Return fallback
      if (typeof fallback === 'function') {
        return await (fallback as (...args: T) => R | Promise<R>)(...args);
      }
      return fallback;
    }
  };
}

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime?: Date;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private readonly threshold: number = 5,
    private readonly timeout: number = 60000, // 1 minute
    private readonly name: string = 'circuit-breaker'
  ) {}

  async execute<R>(fn: () => Promise<R>): Promise<R> {
    // Check if circuit is open
    if (this.state === 'open') {
      const timeSinceLastFailure = this.lastFailureTime 
        ? Date.now() - this.lastFailureTime.getTime()
        : Infinity;
      
      if (timeSinceLastFailure > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new AppError(
          'Circuit breaker is open',
          ErrorCode.SERVICE_UNAVAILABLE,
          503,
          ErrorSeverity.HIGH,
          {
            circuitBreaker: this.name,
            retryAfter: Math.ceil((this.timeout - timeSinceLastFailure) / 1000),
          }
        );
      }
    }

    try {
      const result = await fn();
      
      // Reset on success
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failureCount = 0;
        logger.info(`Circuit breaker ${this.name} closed`);
      }
      
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = new Date();
      
      if (this.failureCount >= this.threshold) {
        this.state = 'open';
        logger.error(`Circuit breaker ${this.name} opened`, error as Error);
      }
      
      throw error;
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = undefined;
  }

  getState(): string {
    return this.state;
  }
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<R>(
  fn: () => Promise<R>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<R> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    factor = 2,
    onRetry,
  } = options;

  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        break;
      }
      
      // Calculate delay with jitter
      const delay = Math.min(
        initialDelay * Math.pow(factor, attempt) + Math.random() * 1000,
        maxDelay
      );
      
      logger.debug(`Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`, {
        error: lastError.message,
        attempt,
        delay,
      });
      
      if (onRetry) {
        onRetry(lastError, attempt + 1);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}