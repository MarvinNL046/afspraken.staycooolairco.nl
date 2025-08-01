/**
 * Centralized Error Types and Classes
 * Provides a comprehensive error handling system with typed errors
 */

// Base error codes
export enum ErrorCode {
  // Authentication & Authorization
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  
  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Resource Errors
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  CONFLICT = 'CONFLICT',
  
  // Business Logic
  BOOKING_UNAVAILABLE = 'BOOKING_UNAVAILABLE',
  SLOT_ALREADY_BOOKED = 'SLOT_ALREADY_BOOKED',
  OUTSIDE_SERVICE_AREA = 'OUTSIDE_SERVICE_AREA',
  INVALID_DATE_RANGE = 'INVALID_DATE_RANGE',
  
  // External Services
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  GOOGLE_MAPS_ERROR = 'GOOGLE_MAPS_ERROR',
  GOHIGHLEVEL_ERROR = 'GOHIGHLEVEL_ERROR',
  GOOGLE_CALENDAR_ERROR = 'GOOGLE_CALENDAR_ERROR',
  EMAIL_SERVICE_ERROR = 'EMAIL_SERVICE_ERROR',
  SMS_SERVICE_ERROR = 'SMS_SERVICE_ERROR',
  
  // System Errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  CACHE_ERROR = 'CACHE_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  
  // Generic
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// Error severity levels
export enum ErrorSeverity {
  LOW = 'low',        // Informational, doesn't affect functionality
  MEDIUM = 'medium',  // Partial degradation, some features affected
  HIGH = 'high',      // Major degradation, core features affected
  CRITICAL = 'critical' // System failure, immediate attention required
}

// Error categories for grouping and filtering
export enum ErrorCategory {
  AUTHENTICATION = 'authentication',
  VALIDATION = 'validation',
  BUSINESS_LOGIC = 'business_logic',
  EXTERNAL_SERVICE = 'external_service',
  INFRASTRUCTURE = 'infrastructure',
  UNKNOWN = 'unknown'
}

// Base error metadata
export interface ErrorMetadata {
  timestamp: Date;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  path?: string;
  method?: string;
  userAgent?: string;
  ip?: string;
  [key: string]: any;
}

// Error context for debugging
export interface ErrorContext {
  service?: string;
  operation?: string;
  input?: any;
  stack?: string;
  causedBy?: Error;
  retryable?: boolean;
  retryAfter?: number; // seconds
  fallbackUsed?: boolean;
  [key: string]: any;
}

/**
 * Base Application Error
 * All custom errors should extend this class
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly severity: ErrorSeverity;
  public readonly category: ErrorCategory;
  public readonly metadata: ErrorMetadata;
  public readonly context: ErrorContext;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    statusCode: number = 500,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    context: ErrorContext = {}
  ) {
    super(message);
    
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.severity = severity;
    this.category = this.categorizeError(code);
    this.context = context;
    this.isOperational = true; // Differentiates from programming errors
    this.metadata = {
      timestamp: new Date(),
      ...context,
    };

    // Maintains proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  private categorizeError(code: ErrorCode): ErrorCategory {
    switch (code) {
      case ErrorCode.UNAUTHORIZED:
      case ErrorCode.FORBIDDEN:
      case ErrorCode.TOKEN_EXPIRED:
      case ErrorCode.TOKEN_INVALID:
      case ErrorCode.SESSION_EXPIRED:
        return ErrorCategory.AUTHENTICATION;
        
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.INVALID_INPUT:
      case ErrorCode.MISSING_REQUIRED_FIELD:
        return ErrorCategory.VALIDATION;
        
      case ErrorCode.BOOKING_UNAVAILABLE:
      case ErrorCode.SLOT_ALREADY_BOOKED:
      case ErrorCode.OUTSIDE_SERVICE_AREA:
      case ErrorCode.INVALID_DATE_RANGE:
        return ErrorCategory.BUSINESS_LOGIC;
        
      case ErrorCode.GOOGLE_MAPS_ERROR:
      case ErrorCode.GOHIGHLEVEL_ERROR:
      case ErrorCode.GOOGLE_CALENDAR_ERROR:
      case ErrorCode.EMAIL_SERVICE_ERROR:
      case ErrorCode.SMS_SERVICE_ERROR:
        return ErrorCategory.EXTERNAL_SERVICE;
        
      case ErrorCode.DATABASE_ERROR:
      case ErrorCode.CACHE_ERROR:
      case ErrorCode.RATE_LIMIT_EXCEEDED:
      case ErrorCode.QUOTA_EXCEEDED:
        return ErrorCategory.INFRASTRUCTURE;
        
      default:
        return ErrorCategory.UNKNOWN;
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      severity: this.severity,
      category: this.category,
      metadata: this.metadata,
      context: {
        ...this.context,
        stack: process.env.NODE_ENV === 'development' ? this.stack : undefined,
      },
    };
  }
}

/**
 * Validation Error
 * Used for input validation failures
 */
export class ValidationError extends AppError {
  public readonly errors: Array<{
    field: string;
    message: string;
    value?: any;
  }>;

  constructor(
    message: string,
    errors: Array<{ field: string; message: string; value?: any }> = [],
    context: ErrorContext = {}
  ) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, ErrorSeverity.LOW, context);
    this.errors = errors;
  }
}

/**
 * Authentication Error
 * Used for authentication failures
 */
export class AuthenticationError extends AppError {
  constructor(
    message: string = 'Authentication required',
    code: ErrorCode = ErrorCode.UNAUTHORIZED,
    context: ErrorContext = {}
  ) {
    super(message, code, 401, ErrorSeverity.MEDIUM, context);
  }
}

/**
 * Authorization Error
 * Used when user lacks permissions
 */
export class AuthorizationError extends AppError {
  constructor(
    message: string = 'Insufficient permissions',
    context: ErrorContext = {}
  ) {
    super(message, ErrorCode.FORBIDDEN, 403, ErrorSeverity.MEDIUM, context);
  }
}

/**
 * Not Found Error
 * Used when requested resource doesn't exist
 */
export class NotFoundError extends AppError {
  constructor(
    resource: string,
    identifier?: string | number,
    context: ErrorContext = {}
  ) {
    const message = identifier 
      ? `${resource} with ID ${identifier} not found`
      : `${resource} not found`;
    super(message, ErrorCode.NOT_FOUND, 404, ErrorSeverity.LOW, context);
  }
}

/**
 * Conflict Error
 * Used when operation conflicts with current state
 */
export class ConflictError extends AppError {
  constructor(
    message: string,
    context: ErrorContext = {}
  ) {
    super(message, ErrorCode.CONFLICT, 409, ErrorSeverity.MEDIUM, context);
  }
}

/**
 * External Service Error
 * Used when external API calls fail
 */
export class ExternalServiceError extends AppError {
  public readonly service: string;
  public readonly originalError?: any;

  constructor(
    service: string,
    message: string,
    originalError?: any,
    code?: ErrorCode,
    context: ErrorContext = {}
  ) {
    const errorCode = code || ErrorCode.EXTERNAL_SERVICE_ERROR;
    super(
      `${service} error: ${message}`,
      errorCode,
      503,
      ErrorSeverity.HIGH,
      { ...context, service }
    );
    this.service = service;
    this.originalError = originalError;
  }
}

/**
 * Rate Limit Error
 * Used when rate limits are exceeded
 */
export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(
    retryAfter: number = 60,
    context: ErrorContext = {}
  ) {
    super(
      `Rate limit exceeded. Try again in ${retryAfter} seconds`,
      ErrorCode.RATE_LIMIT_EXCEEDED,
      429,
      ErrorSeverity.MEDIUM,
      { ...context, retryAfter }
    );
    this.retryAfter = retryAfter;
  }
}

/**
 * Database Error
 * Used for database operation failures
 */
export class DatabaseError extends AppError {
  constructor(
    message: string,
    originalError?: any,
    context: ErrorContext = {}
  ) {
    super(
      message,
      ErrorCode.DATABASE_ERROR,
      500,
      ErrorSeverity.HIGH,
      { ...context, causedBy: originalError }
    );
  }
}

/**
 * Business Logic Error
 * Used for business rule violations
 */
export class BusinessLogicError extends AppError {
  constructor(
    message: string,
    code: ErrorCode,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    context: ErrorContext = {}
  ) {
    super(message, code, 400, severity, context);
  }
}

/**
 * Timeout Error
 * Used when operations exceed time limits
 */
export class TimeoutError extends AppError {
  constructor(
    operation: string,
    timeoutMs: number,
    context: ErrorContext = {}
  ) {
    super(
      `Operation '${operation}' timed out after ${timeoutMs}ms`,
      ErrorCode.TIMEOUT,
      504,
      ErrorSeverity.HIGH,
      { ...context, operation, timeoutMs }
    );
  }
}

/**
 * Cache Error
 * Used for cache operation failures
 */
export class CacheError extends AppError {
  constructor(
    message: string,
    originalError?: any,
    context: ErrorContext = {}
  ) {
    super(
      message,
      ErrorCode.CACHE_ERROR,
      500,
      ErrorSeverity.MEDIUM,
      { ...context, causedBy: originalError, fallbackUsed: true }
    );
  }
}

// Type guard to check if error is operational
export function isOperationalError(error: Error): error is AppError {
  return error instanceof AppError && error.isOperational;
}

// Type guard to check if error is retryable
export function isRetryableError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.context.retryable === true;
  }
  return false;
}

// Helper to create error from unknown type
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(
      error.message,
      ErrorCode.UNKNOWN_ERROR,
      500,
      ErrorSeverity.MEDIUM,
      { causedBy: error }
    );
  }

  if (typeof error === 'string') {
    return new AppError(error);
  }

  return new AppError(
    'An unknown error occurred',
    ErrorCode.UNKNOWN_ERROR,
    500,
    ErrorSeverity.MEDIUM,
    { originalError: error }
  );
}