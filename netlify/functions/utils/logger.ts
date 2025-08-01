import winston from 'winston';
import { LoggingWinston } from '@google-cloud/logging-winston';

// Production logger configuration
const isProd = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const log: any = {
      timestamp,
      level,
      message,
      function: process.env.AWS_LAMBDA_FUNCTION_NAME,
      environment: process.env.NEXT_PUBLIC_ENV,
      ...meta,
    };
    
    // Remove sensitive data
    if (log.headers?.authorization) {
      log.headers.authorization = '[REDACTED]';
    }
    if (log.body?.password) {
      log.body.password = '[REDACTED]';
    }
    if (log.body?.token) {
      log.body.token = '[REDACTED]';
    }
    
    return JSON.stringify(log);
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let output = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      output += ` ${JSON.stringify(meta, null, 2)}`;
    }
    return output;
  })
);

// Create transports
const transports: winston.transport[] = [];

// Console transport (always enabled)
transports.push(
  new winston.transports.Console({
    format: isProd ? structuredFormat : consoleFormat,
  })
);

// Google Cloud Logging for production
if (isProd && process.env.GOOGLE_CLOUD_PROJECT) {
  transports.push(
    new LoggingWinston({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      labels: {
        environment: process.env.NEXT_PUBLIC_ENV || 'production',
        service: 'netlify-functions',
      },
    })
  );
}

// Create logger instance
export const logger = winston.createLogger({
  level: logLevel,
  format: structuredFormat,
  transports,
  defaultMeta: {
    service: 'staycool-api',
  },
});

// Add performance logging
export function logPerformance(operation: string, duration: number, metadata?: any) {
  const performanceData = {
    operation,
    duration,
    durationUnit: 'ms',
    ...metadata,
  };
  
  if (duration > 1000) {
    logger.warn('Slow operation detected', performanceData);
  } else {
    logger.info('Operation completed', performanceData);
  }
}

// Add security event logging
export function logSecurityEvent(event: string, metadata: any) {
  logger.warn('Security event', {
    securityEvent: event,
    ...metadata,
    timestamp: new Date().toISOString(),
  });
}

// Add audit logging
export function logAudit(action: string, userId: string, metadata: any) {
  logger.info('Audit log', {
    audit: true,
    action,
    userId,
    ...metadata,
    timestamp: new Date().toISOString(),
  });
}

// Child logger factory
export function createChildLogger(metadata: any) {
  return logger.child(metadata);
}