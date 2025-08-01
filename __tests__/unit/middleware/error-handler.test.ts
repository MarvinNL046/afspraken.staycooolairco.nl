/**
 * Error Handler Middleware Unit Tests
 * 
 * Tests error handling, logging, and response formatting
 */

import { errorHandler } from '@/lib/middleware/error-handler';
import { 
  AppError, 
  ErrorCode, 
  ErrorSeverity, 
  ErrorCategory,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ExternalServiceError,
} from '@/lib/errors/types';
import { Logger } from '@/lib/services/logging/logger';
import { MonitoringService } from '@/lib/services/monitoring/monitor';
import { Request, Response, NextFunction } from 'express';

// Mock dependencies
jest.mock('@/lib/services/logging/logger');
jest.mock('@/lib/services/monitoring/monitor');

describe('Error Handler Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let mockLogger: jest.Mocked<Logger>;
  let mockMonitoring: jest.Mocked<MonitoringService>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock instances
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    } as any;

    mockMonitoring = {
      metrics: {
        increment: jest.fn(),
        recordHistogram: jest.fn(),
      },
      alerts: {
        checkThresholds: jest.fn(),
      },
    } as any;

    // Set up mocks
    (Logger as jest.MockedClass<typeof Logger>).mockImplementation(() => mockLogger);
    (MonitoringService as jest.MockedClass<typeof MonitoringService>).mockImplementation(() => mockMonitoring);

    // Set up request and response mocks
    mockReq = {
      method: 'GET',
      url: '/api/test',
      headers: {
        'user-agent': 'test-agent',
        'x-forwarded-for': '192.168.1.1',
      },
      ip: '192.168.1.1',
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      headersSent: false,
    };

    mockNext = jest.fn();
  });

  describe('AppError handling', () => {
    it('should handle ValidationError correctly', () => {
      const error = new ValidationError('Invalid input', {
        field: 'email',
        value: 'invalid-email',
      });

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid input',
          details: {
            field: 'email',
            value: 'invalid-email',
          },
        },
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Validation error',
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.VALIDATION_ERROR,
            message: 'Invalid input',
          }),
        })
      );
    });

    it('should handle AuthenticationError correctly', () => {
      const error = new AuthenticationError('Invalid credentials');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.AUTHENTICATION_ERROR,
          message: 'Invalid credentials',
        },
      });
    });

    it('should handle AuthorizationError correctly', () => {
      const error = new AuthorizationError('Insufficient permissions');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.AUTHORIZATION_ERROR,
          message: 'Insufficient permissions',
        },
      });
    });

    it('should handle NotFoundError correctly', () => {
      const error = new NotFoundError('Resource not found');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.NOT_FOUND,
          message: 'Resource not found',
        },
      });
    });

    it('should handle ExternalServiceError correctly', () => {
      const error = new ExternalServiceError('Google Maps API failed');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(502);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.EXTERNAL_SERVICE_ERROR,
          message: 'Google Maps API failed',
        },
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'External service error',
        error,
        expect.any(Object)
      );
    });
  });

  describe('Generic error handling', () => {
    it('should handle standard Error objects', () => {
      const error = new Error('Something went wrong');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Er is een fout opgetreden',
        },
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unhandled error',
        error,
        expect.any(Object)
      );
    });

    it('should handle non-Error objects', () => {
      const error = 'String error';

      errorHandler(error as any, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Er is een fout opgetreden',
        },
      });
    });

    it('should handle null/undefined errors', () => {
      errorHandler(null as any, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Er is een fout opgetreden',
        },
      });
    });
  });

  describe('Severity-based logging', () => {
    it('should log CRITICAL errors with error level', () => {
      const error = new AppError(
        'Critical failure',
        ErrorCode.INTERNAL_ERROR,
        500,
        ErrorSeverity.CRITICAL,
        ErrorCategory.SYSTEM
      );

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Critical system error',
        error,
        expect.any(Object)
      );
    });

    it('should log HIGH severity errors with error level', () => {
      const error = new AppError(
        'High severity error',
        ErrorCode.DATABASE_ERROR,
        500,
        ErrorSeverity.HIGH,
        ErrorCategory.BUSINESS
      );

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'High severity error',
        error,
        expect.any(Object)
      );
    });

    it('should log MEDIUM severity errors with warn level', () => {
      const error = new AppError(
        'Medium severity error',
        ErrorCode.RATE_LIMIT_ERROR,
        429,
        ErrorSeverity.MEDIUM,
        ErrorCategory.BUSINESS
      );

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Business logic error',
        expect.any(Object)
      );
    });

    it('should log LOW severity errors with info level', () => {
      const error = new AppError(
        'Low severity error',
        ErrorCode.VALIDATION_ERROR,
        400,
        ErrorSeverity.LOW,
        ErrorCategory.VALIDATION
      );

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Validation error',
        expect.any(Object)
      );
    });
  });

  describe('Monitoring integration', () => {
    it('should increment error metrics', () => {
      const error = new ValidationError('Invalid input');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockMonitoring.metrics.increment).toHaveBeenCalledWith(
        'http_requests_errors_total',
        1,
        {
          method: 'GET',
          path: '/api/test',
          status_code: '400',
          error_code: ErrorCode.VALIDATION_ERROR,
        }
      );
    });

    it('should check alert thresholds for critical errors', () => {
      const error = new AppError(
        'Critical error',
        ErrorCode.INTERNAL_ERROR,
        500,
        ErrorSeverity.CRITICAL,
        ErrorCategory.SYSTEM
      );

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockMonitoring.alerts.checkThresholds).toHaveBeenCalled();
    });

    it('should not check alerts for low severity errors', () => {
      const error = new ValidationError('Invalid input');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockMonitoring.alerts.checkThresholds).not.toHaveBeenCalled();
    });
  });

  describe('Response handling', () => {
    it('should not send response if headers already sent', () => {
      mockRes.headersSent = true;
      const error = new ValidationError('Invalid input');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should include error details in development mode', () => {
      process.env.NODE_ENV = 'development';
      const error = new ValidationError('Invalid input', { field: 'email' });

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid input',
          details: { field: 'email' },
          stack: expect.any(String),
        },
      });

      process.env.NODE_ENV = 'test';
    });

    it('should hide error details in production mode', () => {
      process.env.NODE_ENV = 'production';
      const error = new AppError(
        'Internal error with sensitive details',
        ErrorCode.INTERNAL_ERROR,
        500,
        ErrorSeverity.HIGH,
        ErrorCategory.SYSTEM,
        { password: 'secret123' }
      );

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Er is een fout opgetreden',
        },
      });

      process.env.NODE_ENV = 'test';
    });
  });

  describe('Request context', () => {
    it('should include request context in logs', () => {
      const error = new ValidationError('Invalid input');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Validation error',
        expect.objectContaining({
          request: {
            method: 'GET',
            url: '/api/test',
            ip: '192.168.1.1',
            userAgent: 'test-agent',
          },
        })
      );
    });

    it('should handle missing request properties', () => {
      mockReq = {};
      const error = new ValidationError('Invalid input');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Validation error',
        expect.objectContaining({
          request: {
            method: undefined,
            url: undefined,
            ip: undefined,
            userAgent: undefined,
          },
        })
      );
    });
  });
});