/**
 * Structured Logging Service
 * Provides comprehensive logging with context, levels, and transport options
 */

import { AppError, ErrorSeverity, ErrorCategory } from '@/lib/errors/types';
import { hostname } from 'os';

// Log levels based on RFC 5424 severity
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

// Numeric severity for comparison
const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
  [LogLevel.FATAL]: 4,
};

// Log entry structure
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  hostname: string;
  pid: number;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  duration?: number;
  context?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
    severity?: ErrorSeverity;
    category?: ErrorCategory;
  };
  performance?: {
    cpuUsage?: NodeJS.CpuUsage;
    memoryUsage?: NodeJS.MemoryUsage;
    latency?: number;
  };
}

// Logger configuration
export interface LoggerConfig {
  service: string;
  level: LogLevel;
  pretty: boolean;
  includeStack: boolean;
  maxContextDepth: number;
  transports: LogTransport[];
}

// Log transport interface
export interface LogTransport {
  name: string;
  log(entry: LogEntry): void | Promise<void>;
}

// Console transport for local development
export class ConsoleTransport implements LogTransport {
  name = 'console';
  private pretty: boolean;

  constructor(pretty: boolean = true) {
    this.pretty = pretty;
  }

  log(entry: LogEntry): void {
    const level = entry.level.toUpperCase();
    const timestamp = entry.timestamp;
    const message = entry.message;

    if (this.pretty) {
      const color = this.getColor(entry.level);
      const prefix = `${color}[${timestamp}] ${level}${this.reset}`;
      console.log(`${prefix} ${message}`);
      
      if (entry.context && Object.keys(entry.context).length > 0) {
        console.log(`${color}Context:${this.reset}`, entry.context);
      }
      
      if (entry.error) {
        console.log(`${color}Error:${this.reset}`, entry.error);
      }
    } else {
      // JSON output for production
      console.log(JSON.stringify(entry));
    }
  }

  private getColor(level: LogLevel): string {
    const colors = {
      [LogLevel.DEBUG]: '\x1b[36m', // Cyan
      [LogLevel.INFO]: '\x1b[32m',  // Green
      [LogLevel.WARN]: '\x1b[33m',  // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
      [LogLevel.FATAL]: '\x1b[35m', // Magenta
    };
    return colors[level] || '';
  }

  private reset = '\x1b[0m';
}

// File transport for persistent logging
export class FileTransport implements LogTransport {
  name = 'file';
  private filename: string;
  private fs: typeof import('fs');
  
  constructor(filename: string) {
    this.filename = filename;
    // Lazy load fs module
    this.fs = require('fs');
  }

  async log(entry: LogEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    
    try {
      await this.fs.promises.appendFile(this.filename, line, 'utf8');
    } catch (error) {
      console.error('Failed to write log to file:', error);
    }
  }
}

// External service transport (e.g., for monitoring services)
export class ExternalServiceTransport implements LogTransport {
  name = 'external';
  private endpoint: string;
  private apiKey: string;
  private batchSize: number;
  private batchInterval: number;
  private batch: LogEntry[] = [];
  private timer?: NodeJS.Timeout;

  constructor(config: {
    endpoint: string;
    apiKey: string;
    batchSize?: number;
    batchInterval?: number;
  }) {
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.batchSize = config.batchSize || 100;
    this.batchInterval = config.batchInterval || 5000; // 5 seconds
    
    // Start batch timer
    this.startBatchTimer();
  }

  async log(entry: LogEntry): Promise<void> {
    this.batch.push(entry);
    
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }
  }

  private startBatchTimer(): void {
    this.timer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.batchInterval);
  }

  private async flush(): Promise<void> {
    if (this.batch.length === 0) return;
    
    const entries = [...this.batch];
    this.batch = [];
    
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ logs: entries }),
      });
      
      if (!response.ok) {
        throw new Error(`Log upload failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to send logs to external service:', error);
      // Re-add to batch for retry
      this.batch.unshift(...entries);
    }
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.flush().catch(console.error);
  }
}

/**
 * Main Logger Class
 */
export class Logger {
  private config: LoggerConfig;
  private context: Record<string, any> = {};
  private static instance: Logger;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      service: config.service || 'staycool-app',
      level: config.level || LogLevel.INFO,
      pretty: config.pretty ?? process.env.NODE_ENV === 'development',
      includeStack: config.includeStack ?? process.env.NODE_ENV === 'development',
      maxContextDepth: config.maxContextDepth || 5,
      transports: config.transports || [
        new ConsoleTransport(config.pretty ?? true),
      ],
    };
  }

  static getInstance(config?: Partial<LoggerConfig>): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  // Set context for all subsequent logs
  setContext(context: Record<string, any>): void {
    this.context = { ...this.context, ...context };
  }

  // Clear context
  clearContext(): void {
    this.context = {};
  }

  // Create child logger with additional context
  child(context: Record<string, any>): Logger {
    const childLogger = new Logger(this.config);
    childLogger.context = { ...this.context, ...context };
    return childLogger;
  }

  // Core logging methods
  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error | AppError, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  fatal(message: string, error?: Error | AppError, context?: Record<string, any>): void {
    this.log(LogLevel.FATAL, message, context, error);
  }

  // Performance logging
  logPerformance(
    operation: string,
    duration: number,
    context?: Record<string, any>
  ): void {
    const performanceContext = {
      ...context,
      performance: {
        operation,
        duration,
        cpuUsage: process.cpuUsage(),
        memoryUsage: process.memoryUsage(),
      },
    };
    
    const level = duration > 1000 ? LogLevel.WARN : LogLevel.INFO;
    this.log(level, `Operation '${operation}' completed in ${duration}ms`, performanceContext);
  }

  // HTTP request logging
  logHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    context?: Record<string, any>
  ): void {
    const level = statusCode >= 500 ? LogLevel.ERROR : 
                  statusCode >= 400 ? LogLevel.WARN : 
                  LogLevel.INFO;
    
    this.log(level, `${method} ${path} ${statusCode} ${duration}ms`, {
      ...context,
      http: { method, path, statusCode, duration },
    });
  }

  // Database query logging
  logDatabaseQuery(
    operation: string,
    duration: number,
    success: boolean,
    context?: Record<string, any>
  ): void {
    const level = !success ? LogLevel.ERROR : 
                  duration > 1000 ? LogLevel.WARN : 
                  LogLevel.DEBUG;
    
    this.log(level, `Database ${operation} ${success ? 'succeeded' : 'failed'} in ${duration}ms`, {
      ...context,
      database: { operation, duration, success },
    });
  }

  // External service logging
  logExternalCall(
    service: string,
    operation: string,
    duration: number,
    success: boolean,
    context?: Record<string, any>
  ): void {
    const level = !success ? LogLevel.ERROR : 
                  duration > 3000 ? LogLevel.WARN : 
                  LogLevel.INFO;
    
    this.log(level, `External call to ${service}.${operation} ${success ? 'succeeded' : 'failed'} in ${duration}ms`, {
      ...context,
      external: { service, operation, duration, success },
    });
  }

  // Main logging method
  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error | AppError
  ): void {
    // Check if we should log this level
    if (LOG_LEVEL_SEVERITY[level] < LOG_LEVEL_SEVERITY[this.config.level]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.config.service,
      hostname: hostname(),
      pid: process.pid,
      context: this.sanitizeContext({ ...this.context, ...context }),
    };

    // Add error information
    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: this.config.includeStack ? error.stack : undefined,
      };

      if (error instanceof AppError) {
        entry.error.code = error.code;
        entry.error.severity = error.severity;
        entry.error.category = error.category;
        entry.context = { ...entry.context, ...error.context };
      }
    }

    // Send to all transports
    for (const transport of this.config.transports) {
      try {
        const result = transport.log(entry);
        if (result instanceof Promise) {
          result.catch(err => 
            console.error(`Transport ${transport.name} failed:`, err)
          );
        }
      } catch (err) {
        console.error(`Transport ${transport.name} failed:`, err);
      }
    }
  }

  // Sanitize context to prevent logging sensitive data
  private sanitizeContext(
    context: Record<string, any>,
    depth: number = 0
  ): Record<string, any> {
    if (depth > this.config.maxContextDepth) {
      return { _truncated: true };
    }

    const sanitized: Record<string, any> = {};
    const sensitiveKeys = [
      'password', 'token', 'apiKey', 'secret', 'authorization',
      'creditCard', 'cvv', 'ssn', 'pin'
    ];

    for (const [key, value] of Object.entries(context)) {
      // Check for sensitive keys
      if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Handle different value types
      if (value === null || value === undefined) {
        sanitized[key] = value;
      } else if (typeof value === 'function') {
        sanitized[key] = '[Function]';
      } else if (value instanceof Error) {
        sanitized[key] = {
          name: value.name,
          message: value.message,
          stack: this.config.includeStack ? value.stack : undefined,
        };
      } else if (typeof value === 'object') {
        if (Array.isArray(value)) {
          sanitized[key] = value.slice(0, 10).map(v => 
            typeof v === 'object' ? this.sanitizeContext(v, depth + 1) : v
          );
          if (value.length > 10) {
            sanitized[key].push(`... ${value.length - 10} more items`);
          }
        } else {
          sanitized[key] = this.sanitizeContext(value, depth + 1);
        }
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

// Default logger instance
export const logger = Logger.getInstance({
  level: (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO,
  pretty: process.env.NODE_ENV === 'development',
});

// Convenience exports
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const fatal = logger.fatal.bind(logger);