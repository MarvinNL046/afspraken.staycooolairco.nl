/**
 * Security Logger Service
 * 
 * Provides secure logging for authentication events, security incidents,
 * and audit trails. Ensures sensitive data is never logged.
 */

import { createHash } from 'crypto';
import { securityConfig } from '@/lib/config/security';

// Security event types
export enum SecurityEventType {
  // Authentication events
  AUTH_SUCCESS = 'AUTH_SUCCESS',
  AUTH_FAILURE = 'AUTH_FAILURE',
  TOKEN_GENERATED = 'TOKEN_GENERATED',
  TOKEN_REFRESHED = 'TOKEN_REFRESHED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  
  // Security incidents
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  CSRF_VIOLATION = 'CSRF_VIOLATION',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  IP_BLOCKED = 'IP_BLOCKED',
  
  // Access control
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  
  // Validation
  INPUT_VALIDATION_FAILED = 'INPUT_VALIDATION_FAILED',
  VERIFICATION_CODE_SENT = 'VERIFICATION_CODE_SENT',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
}

// Log levels
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

// Security log entry interface
export interface SecurityLogEntry {
  timestamp: Date;
  level: LogLevel;
  eventType: SecurityEventType;
  message: string;
  metadata?: Record<string, any>;
  userId?: string;
  sessionId?: string;
  ipHash?: string;
  userAgentHash?: string;
  requestId?: string;
}

export class SecurityLogger {
  private readonly sensitiveFields = new Set(securityConfig.logging.sensitiveFields);
  private readonly logLevel = this.parseLogLevel(securityConfig.logging.logLevel);

  /**
   * Log a security event
   */
  log(
    level: LogLevel,
    eventType: SecurityEventType,
    message: string,
    metadata?: Record<string, any>
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: SecurityLogEntry = {
      timestamp: new Date(),
      level,
      eventType,
      message,
      metadata: metadata ? this.sanitizeMetadata(metadata) : undefined,
    };

    this.writeLog(entry);
  }

  /**
   * Log authentication success
   */
  logAuthSuccess(userId: string, sessionId: string, metadata?: Record<string, any>): void {
    this.log(
      LogLevel.INFO,
      SecurityEventType.AUTH_SUCCESS,
      'Successful authentication',
      {
        ...metadata,
        userId: this.hashId(userId),
        sessionId: this.hashId(sessionId),
      }
    );
  }

  /**
   * Log authentication failure
   */
  logAuthFailure(email: string, reason: string, metadata?: Record<string, any>): void {
    this.log(
      LogLevel.WARN,
      SecurityEventType.AUTH_FAILURE,
      `Authentication failed: ${reason}`,
      {
        ...metadata,
        emailHash: this.hashEmail(email),
      }
    );
  }

  /**
   * Log rate limit exceeded
   */
  logRateLimitExceeded(
    clientId: string,
    endpoint: string,
    metadata?: Record<string, any>
  ): void {
    this.log(
      LogLevel.WARN,
      SecurityEventType.RATE_LIMIT_EXCEEDED,
      `Rate limit exceeded for endpoint: ${endpoint}`,
      {
        ...metadata,
        clientIdHash: this.hashId(clientId),
        endpoint,
      }
    );
  }

  /**
   * Log CSRF violation
   */
  logCSRFViolation(
    sessionId: string,
    endpoint: string,
    metadata?: Record<string, any>
  ): void {
    this.log(
      LogLevel.ERROR,
      SecurityEventType.CSRF_VIOLATION,
      `CSRF token validation failed for endpoint: ${endpoint}`,
      {
        ...metadata,
        sessionIdHash: this.hashId(sessionId),
        endpoint,
      }
    );
  }

  /**
   * Log suspicious activity
   */
  logSuspiciousActivity(
    description: string,
    clientId: string,
    metadata?: Record<string, any>
  ): void {
    this.log(
      LogLevel.WARN,
      SecurityEventType.SUSPICIOUS_ACTIVITY,
      description,
      {
        ...metadata,
        clientIdHash: this.hashId(clientId),
      }
    );
  }

  /**
   * Log IP blocked
   */
  logIPBlocked(clientId: string, reason: string): void {
    this.log(
      LogLevel.WARN,
      SecurityEventType.IP_BLOCKED,
      `IP blocked: ${reason}`,
      {
        clientIdHash: this.hashId(clientId),
      }
    );
  }

  /**
   * Log token generation
   */
  logTokenGenerated(userId: string, sessionId: string, tokenType: string): void {
    this.log(
      LogLevel.INFO,
      SecurityEventType.TOKEN_GENERATED,
      `${tokenType} token generated`,
      {
        userId: this.hashId(userId),
        sessionId: this.hashId(sessionId),
        tokenType,
      }
    );
  }

  /**
   * Sanitize metadata to remove sensitive information
   */
  private sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      // Skip sensitive fields
      if (this.isSensitiveField(key)) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Recursively sanitize nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMetadata(value);
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(item => 
          typeof item === 'object' ? this.sanitizeMetadata(item) : item
        );
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Check if a field name is sensitive
   */
  private isSensitiveField(fieldName: string): boolean {
    const lowerFieldName = fieldName.toLowerCase();
    return Array.from(this.sensitiveFields).some(sensitive => 
      lowerFieldName.includes(sensitive.toLowerCase())
    );
  }

  /**
   * Hash an ID for privacy
   */
  private hashId(id: string): string {
    return createHash('sha256').update(id).digest('hex').substring(0, 16);
  }

  /**
   * Hash an email for privacy
   */
  private hashEmail(email: string): string {
    const [localPart, domain] = email.toLowerCase().split('@');
    const hashedLocal = createHash('sha256').update(localPart).digest('hex').substring(0, 8);
    return `${hashedLocal}@${domain}`;
  }

  /**
   * Check if event should be logged based on level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.CRITICAL];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const eventLevelIndex = levels.indexOf(level);
    return eventLevelIndex >= currentLevelIndex;
  }

  /**
   * Parse log level from string
   */
  private parseLogLevel(level: string): LogLevel {
    const upperLevel = level.toUpperCase();
    return LogLevel[upperLevel as keyof typeof LogLevel] || LogLevel.INFO;
  }

  /**
   * Write log entry (in production, this would go to a secure logging service)
   */
  private writeLog(entry: SecurityLogEntry): void {
    const formattedLog = {
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    };

    // In production, send to logging service (e.g., CloudWatch, Datadog, etc.)
    // For now, use console with appropriate level
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug('[SECURITY]', formattedLog);
        break;
      case LogLevel.INFO:
        console.info('[SECURITY]', formattedLog);
        break;
      case LogLevel.WARN:
        console.warn('[SECURITY]', formattedLog);
        break;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        console.error('[SECURITY]', formattedLog);
        break;
    }
  }
}

// Export singleton instance
export const securityLogger = new SecurityLogger();

// Audit trail helper
export class AuditTrail {
  static async logAction(
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const entry = {
      timestamp: new Date().toISOString(),
      userId,
      action,
      resourceType,
      resourceId,
      metadata: metadata || {},
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
    };

    // In production, store in audit database
    console.info('[AUDIT]', entry);
  }
}