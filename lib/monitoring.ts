import { performance } from 'perf_hooks';

/**
 * Comprehensive Monitoring and Logging System
 * 
 * Features:
 * - Performance monitoring with detailed metrics
 * - Structured logging with different levels
 * - Business metrics tracking
 * - Error tracking and alerting
 * - Health monitoring
 * - Real-time analytics
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4,
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  data?: any;
  context?: {
    requestId?: string;
    userId?: string;
    function?: string;
    duration?: number;
    statusCode?: number;
  };
  tags?: string[];
  source: string;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'count' | 'bytes' | 'percent';
  timestamp: Date;
  tags?: Record<string, string>;
}

export interface BusinessMetric {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram';
  timestamp: Date;
  dimensions?: Record<string, string>;
}

export interface ErrorEvent {
  id: string;
  error: Error;
  context: {
    requestId?: string;
    userId?: string;
    function?: string;
    input?: any;
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  stackTrace: string;
  fingerprint: string; // For grouping similar errors
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, {
    status: 'healthy' | 'degraded' | 'unhealthy';
    responseTime?: number;
    errorRate?: number;
    lastCheck: Date;
    details?: any;
  }>;
  timestamp: Date;
}

class MonitoringService {
  private logs: LogEntry[] = [];
  private performanceMetrics: PerformanceMetric[] = [];
  private businessMetrics: BusinessMetric[] = [];
  private errors: ErrorEvent[] = [];
  private healthChecks: Map<string, any> = new Map();
  
  private readonly maxLogEntries = 1000;
  private readonly maxMetrics = 500;
  private readonly maxErrors = 100;
  
  private performanceTimers = new Map<string, number>();
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  
  constructor() {
    // Periodic cleanup
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes
    
    // Health monitoring
    setInterval(() => {
      this.performSystemHealthCheck();
    }, 30 * 1000); // Every 30 seconds
  }
  
  /**
   * Structured logging with different levels
   */
  log(level: LogLevel, message: string, data?: any, context?: any, tags?: string[]): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      data,
      context,
      tags,
      source: this.getCallerId(),
    };
    
    this.logs.push(entry);
    
    // Console output with formatting
    this.outputToConsole(entry);
    
    // Trigger alerts for critical errors
    if (level >= LogLevel.ERROR) {
      this.handleErrorLog(entry);
    }
    
    // Maintain size limit
    if (this.logs.length > this.maxLogEntries) {
      this.logs = this.logs.slice(-this.maxLogEntries);
    }
  }
  
  /**
   * Debug logging
   */
  debug(message: string, data?: any, context?: any): void {
    if (process.env.NODE_ENV === 'development') {
      this.log(LogLevel.DEBUG, message, data, context, ['debug']);
    }
  }
  
  /**
   * Info logging
   */
  info(message: string, data?: any, context?: any): void {
    this.log(LogLevel.INFO, message, data, context, ['info']);
  }
  
  /**
   * Warning logging
   */
  warn(message: string, data?: any, context?: any): void {
    this.log(LogLevel.WARN, message, data, context, ['warning']);
  }
  
  /**
   * Error logging
   */
  error(message: string, error?: Error, context?: any): void {
    this.log(LogLevel.ERROR, message, {
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    }, context, ['error']);
    
    if (error) {
      this.trackError(error, context, 'high');
    }
  }
  
  /**
   * Critical error logging
   */
  critical(message: string, error?: Error, context?: any): void {
    this.log(LogLevel.CRITICAL, message, {
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    }, context, ['critical']);
    
    if (error) {
      this.trackError(error, context, 'critical');
    }
  }
  
  /**
   * Start performance timing
   */
  startTimer(name: string): void {
    this.performanceTimers.set(name, performance.now());
  }
  
  /**
   * End performance timing and record metric
   */
  endTimer(name: string, tags?: Record<string, string>): number {
    const startTime = this.performanceTimers.get(name);
    if (!startTime) {
      this.warn(`Timer '${name}' was not started`);
      return 0;
    }
    
    const duration = performance.now() - startTime;
    this.performanceTimers.delete(name);
    
    this.recordPerformanceMetric(name, duration, 'ms', tags);
    
    return duration;
  }
  
  /**
   * Record a performance metric
   */
  recordPerformanceMetric(name: string, value: number, unit: 'ms' | 'count' | 'bytes' | 'percent', tags?: Record<string, string>): void {
    const metric: PerformanceMetric = {
      name,
      value,
      unit,
      timestamp: new Date(),
      tags,
    };
    
    this.performanceMetrics.push(metric);
    
    // Maintain size limit
    if (this.performanceMetrics.length > this.maxMetrics) {
      this.performanceMetrics = this.performanceMetrics.slice(-this.maxMetrics);
    }
  }
  
  /**
   * Increment a counter
   */
  incrementCounter(name: string, value: number = 1, dimensions?: Record<string, string>): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
    
    this.recordBusinessMetric(name, current + value, 'counter', dimensions);
  }
  
  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, dimensions?: Record<string, string>): void {
    this.gauges.set(name, value);
    this.recordBusinessMetric(name, value, 'gauge', dimensions);
  }
  
  /**
   * Record a business metric
   */
  recordBusinessMetric(name: string, value: number, type: 'counter' | 'gauge' | 'histogram', dimensions?: Record<string, string>): void {
    const metric: BusinessMetric = {
      name,
      value,
      type,
      timestamp: new Date(),
      dimensions,
    };
    
    this.businessMetrics.push(metric);
    
    // Maintain size limit
    if (this.businessMetrics.length > this.maxMetrics) {
      this.businessMetrics = this.businessMetrics.slice(-this.maxMetrics);
    }
  }
  
  /**
   * Track an error event
   */
  trackError(error: Error, context?: any, severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'): void {
    const errorEvent: ErrorEvent = {
      id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
      error,
      context: context || {},
      severity,
      timestamp: new Date(),
      stackTrace: error.stack || '',
      fingerprint: this.generateErrorFingerprint(error),
    };
    
    this.errors.push(errorEvent);
    
    // Maintain size limit
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }
    
    // Increment error counter
    this.incrementCounter('errors.total', 1, {
      severity,
      errorType: error.name,
    });
    
    // Send alert for critical errors
    if (severity === 'critical') {
      this.sendAlert(errorEvent);
    }
  }
  
  /**
   * Register a health check
   */
  registerHealthCheck(name: string, check: () => Promise<any>): void {
    this.healthChecks.set(name, check);
  }
  
  /**
   * Perform system health check
   */
  async performSystemHealthCheck(): Promise<HealthStatus> {
    const components: HealthStatus['components'] = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    for (const [name, check] of this.healthChecks.entries()) {
      const startTime = performance.now();
      
      try {
        const result = await Promise.race([
          check(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          )
        ]);
        
        const responseTime = performance.now() - startTime;
        
        components[name] = {
          status: 'healthy',
          responseTime,
          lastCheck: new Date(),
          details: result,
        };
        
      } catch (error) {
        components[name] = {
          status: 'unhealthy',
          responseTime: performance.now() - startTime,
          lastCheck: new Date(),
          details: error instanceof Error ? error.message : 'Unknown error',
        };
        
        overallStatus = 'unhealthy';
      }
    }
    
    // Check error rates
    const recentErrors = this.getRecentErrors(5 * 60 * 1000); // Last 5 minutes
    if (recentErrors.length > 10) {
      overallStatus = 'degraded';
    }
    if (recentErrors.length > 50) {
      overallStatus = 'unhealthy';
    }
    
    return {
      status: overallStatus,
      components,
      timestamp: new Date(),
    };
  }
  
  /**
   * Get recent log entries
   */
  getRecentLogs(minutes: number = 5, level?: LogLevel): LogEntry[] {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    
    return this.logs.filter(log => {
      const isRecent = log.timestamp >= cutoff;
      const matchesLevel = level === undefined || log.level >= level;
      return isRecent && matchesLevel;
    });
  }
  
  /**
   * Get recent errors
   */
  getRecentErrors(milliseconds: number = 5 * 60 * 1000): ErrorEvent[] {
    const cutoff = new Date(Date.now() - milliseconds);
    return this.errors.filter(error => error.timestamp >= cutoff);
  }
  
  /**
   * Get performance metrics
   */
  getPerformanceMetrics(name?: string, minutes: number = 5): PerformanceMetric[] {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    
    return this.performanceMetrics.filter(metric => {
      const isRecent = metric.timestamp >= cutoff;
      const matchesName = !name || metric.name === name;
      return isRecent && matchesName;
    });
  }
  
  /**
   * Get business metrics
   */
  getBusinessMetrics(name?: string, minutes: number = 5): BusinessMetric[] {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    
    return this.businessMetrics.filter(metric => {
      const isRecent = metric.timestamp >= cutoff;
      const matchesName = !name || metric.name === name;
      return isRecent && matchesName;
    });
  }
  
  /**
   * Get analytics summary
   */
  getAnalyticsSummary(minutes: number = 60): {
    requests: number;
    errors: number;
    errorRate: number;
    averageResponseTime: number;
    slowRequests: number;
    topErrors: Array<{ error: string; count: number }>;
  } {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    
    const recentLogs = this.logs.filter(log => log.timestamp >= cutoff);
    const recentErrors = this.errors.filter(error => error.timestamp >= cutoff);
    const recentPerformance = this.performanceMetrics.filter(metric => 
      metric.timestamp >= cutoff && metric.unit === 'ms'
    );
    
    const requests = recentLogs.filter(log => 
      log.tags?.includes('request') || log.context?.statusCode
    ).length;
    
    const errors = recentErrors.length;
    const errorRate = requests > 0 ? (errors / requests) * 100 : 0;
    
    const responseTimes = recentPerformance.map(m => m.value);
    const averageResponseTime = responseTimes.length > 0 
      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length 
      : 0;
    
    const slowRequests = responseTimes.filter(time => time > 3000).length;
    
    // Group errors by type
    const errorCounts = new Map<string, number>();
    recentErrors.forEach(error => {
      const key = error.error.name;
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    });
    
    const topErrors = Array.from(errorCounts.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    return {
      requests,
      errors,
      errorRate: Math.round(errorRate * 100) / 100,
      averageResponseTime: Math.round(averageResponseTime * 100) / 100,
      slowRequests,
      topErrors,
    };
  }
  
  /**
   * Output log entry to console with formatting
   */
  private outputToConsole(entry: LogEntry): void {
    const timestamp = entry.timestamp.toISOString();
    const level = LogLevel[entry.level];
    const context = entry.context ? ` [${entry.context.requestId || 'unknown'}]` : '';
    const tags = entry.tags ? ` (${entry.tags.join(', ')})` : '';
    
    const message = `[${timestamp}] ${level}${context}: ${entry.message}${tags}`;
    
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(message, entry.data);
        break;
      case LogLevel.INFO:
        console.info(message, entry.data);
        break;
      case LogLevel.WARN:
        console.warn(message, entry.data);
        break;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        console.error(message, entry.data);
        break;
    }
  }
  
  /**
   * Handle error logs (alerting, etc.)
   */
  private handleErrorLog(entry: LogEntry): void {
    if (entry.level >= LogLevel.CRITICAL) {
      // In a real implementation, this would send alerts via email, Slack, etc.
      console.error('🚨 CRITICAL ERROR ALERT:', entry.message);
    }
  }
  
  /**
   * Generate error fingerprint for grouping
   */
  private generateErrorFingerprint(error: Error): string {
    const key = `${error.name}:${error.message}`;
    return Buffer.from(key).toString('base64').substring(0, 16);
  }
  
  /**
   * Get caller ID for logging context
   */
  private getCallerId(): string {
    const stack = new Error().stack;
    if (!stack) return 'unknown';
    
    const lines = stack.split('\n');
    const callerLine = lines[4]; // Skip the monitoring functions
    
    if (callerLine) {
      const match = callerLine.match(/at\s+(.+?)\s+\(/);
      return match ? match[1] : 'unknown';
    }
    
    return 'unknown';
  }
  
  /**
   * Send alert for critical errors
   */
  private sendAlert(errorEvent: ErrorEvent): void {
    // In a real implementation, this would integrate with alerting services
    console.error('🚨 CRITICAL ERROR ALERT:', {
      id: errorEvent.id,
      error: errorEvent.error.message,
      context: errorEvent.context,
      timestamp: errorEvent.timestamp,
    });
  }
  
  /**
   * Cleanup old entries
   */
  private cleanup(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
    
    this.logs = this.logs.filter(log => log.timestamp >= cutoff);
    this.performanceMetrics = this.performanceMetrics.filter(metric => metric.timestamp >= cutoff);
    this.businessMetrics = this.businessMetrics.filter(metric => metric.timestamp >= cutoff);
    this.errors = this.errors.filter(error => error.timestamp >= cutoff);
    
    console.info('[Monitoring] Cleanup completed', {
      logs: this.logs.length,
      performanceMetrics: this.performanceMetrics.length,
      businessMetrics: this.businessMetrics.length,
      errors: this.errors.length,
    });
  }
}

// Global singleton instance
const monitoring = new MonitoringService();

// Export convenience functions
export const logger = {
  debug: (message: string, data?: any, context?: any) => monitoring.debug(message, data, context),
  info: (message: string, data?: any, context?: any) => monitoring.info(message, data, context),
  warn: (message: string, data?: any, context?: any) => monitoring.warn(message, data, context),
  error: (message: string, error?: Error, context?: any) => monitoring.error(message, error, context),
  critical: (message: string, error?: Error, context?: any) => monitoring.critical(message, error, context),
};

export const metrics = {
  startTimer: (name: string) => monitoring.startTimer(name),
  endTimer: (name: string, tags?: Record<string, string>) => monitoring.endTimer(name, tags),
  recordPerformance: (name: string, value: number, unit: 'ms' | 'count' | 'bytes' | 'percent', tags?: Record<string, string>) =>
    monitoring.recordPerformanceMetric(name, value, unit, tags),
  incrementCounter: (name: string, value?: number, dimensions?: Record<string, string>) =>
    monitoring.incrementCounter(name, value, dimensions),
  setGauge: (name: string, value: number, dimensions?: Record<string, string>) =>
    monitoring.setGauge(name, value, dimensions),
};

export const errorTracking = {
  trackError: (error: Error, context?: any, severity?: 'low' | 'medium' | 'high' | 'critical') =>
    monitoring.trackError(error, context, severity),
};

export const healthMonitoring = {
  registerHealthCheck: (name: string, check: () => Promise<any>) =>
    monitoring.registerHealthCheck(name, check),
  performHealthCheck: () => monitoring.performSystemHealthCheck(),
};

export const analytics = {
  getRecentLogs: (minutes?: number, level?: LogLevel) => monitoring.getRecentLogs(minutes, level),
  getRecentErrors: (milliseconds?: number) => monitoring.getRecentErrors(milliseconds),
  getPerformanceMetrics: (name?: string, minutes?: number) => monitoring.getPerformanceMetrics(name, minutes),
  getBusinessMetrics: (name?: string, minutes?: number) => monitoring.getBusinessMetrics(name, minutes),
  getSummary: (minutes?: number) => monitoring.getAnalyticsSummary(minutes),
};

/**
 * Middleware for automatic request monitoring
 */
export function createMonitoringMiddleware() {
  return async (event: any, context: any) => {
    const requestId = context.requestId || `req_${Date.now()}`;
    const startTime = performance.now();
    
    // Log request start
    logger.info('Request started', {
      method: event.httpMethod,
      path: event.path,
      userAgent: event.headers?.['user-agent'],
      ip: event.headers?.['x-forwarded-for'],
    }, { requestId, function: event.path });
    
    // Start performance timer
    metrics.startTimer(`request.${event.httpMethod}.${event.path}`);
    
    // Track request counter
    metrics.incrementCounter('requests.total', 1, {
      method: event.httpMethod,
      path: event.path,
    });
    
    // Add monitoring context
    context.monitoring = {
      requestId,
      startTime,
      logContext: { requestId, function: event.path },
    };
    
    return context;
  };
}

/**
 * Middleware for automatic response monitoring
 */
export function createResponseMonitoringMiddleware() {
  return (handler: any) => {
    return async (event: any, context: any) => {
      try {
        const response = await handler(event, context);
        
        // End performance timer
        const duration = metrics.endTimer(`request.${event.httpMethod}.${event.path}`);
        
        // Log successful response
        logger.info('Request completed', {
          statusCode: response.statusCode,
          duration: Math.round(duration),
        }, context.monitoring?.logContext);
        
        // Track response metrics
        metrics.incrementCounter('responses.total', 1, {
          method: event.httpMethod,
          path: event.path,
          statusCode: response.statusCode?.toString(),
        });
        
        if (duration > 3000) {
          logger.warn('Slow request detected', {
            duration: Math.round(duration),
            threshold: 3000,
          }, context.monitoring?.logContext);
        }
        
        return response;
      } catch (error) {
        // Track error
        errorTracking.trackError(
          error instanceof Error ? error : new Error('Unknown error'),
          context.monitoring?.logContext,
          'high'
        );
        
        throw error;
      }
    };
  };
}

export default monitoring;