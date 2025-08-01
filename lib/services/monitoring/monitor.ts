/**
 * Monitoring and Alerting System
 * Provides comprehensive monitoring, metrics collection, and alerting
 */

import { EventEmitter } from 'events';
import { Logger, LogLevel } from '../logging/logger';
import { AppError, ErrorSeverity } from '@/lib/errors/types';

// Metric types
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
}

// Metric labels
export interface MetricLabels {
  [key: string]: string | number;
}

// Base metric interface
export interface Metric {
  name: string;
  type: MetricType;
  help: string;
  labels: MetricLabels;
  value: number;
  timestamp: Date;
}

// Alert severity levels
export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

// Alert condition
export interface AlertCondition {
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
  duration?: number; // seconds
  severity: AlertSeverity;
}

// Alert interface
export interface Alert {
  id: string;
  name: string;
  condition: AlertCondition;
  message: string;
  severity: AlertSeverity;
  triggered: boolean;
  triggeredAt?: Date;
  resolvedAt?: Date;
  metadata?: Record<string, any>;
}

// System health status
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

// Component health check
export interface HealthCheck {
  name: string;
  status: HealthStatus;
  message?: string;
  latency?: number;
  metadata?: Record<string, any>;
}

// Monitoring configuration
export interface MonitoringConfig {
  collectInterval: number; // milliseconds
  retentionPeriod: number; // milliseconds
  alertCheckInterval: number; // milliseconds
  maxMetricsPerType: number;
}

/**
 * Metrics Collector
 * Collects and stores application metrics
 */
export class MetricsCollector {
  private metrics: Map<string, Metric[]> = new Map();
  private config: MonitoringConfig;

  constructor(config: Partial<MonitoringConfig> = {}) {
    this.config = {
      collectInterval: config.collectInterval || 60000, // 1 minute
      retentionPeriod: config.retentionPeriod || 3600000, // 1 hour
      maxMetricsPerType: config.maxMetricsPerType || 1000,
      alertCheckInterval: config.alertCheckInterval || 30000, // 30 seconds
    };

    // Start cleanup timer
    setInterval(() => this.cleanup(), this.config.collectInterval);
  }

  // Record a counter metric
  increment(name: string, value: number = 1, labels: MetricLabels = {}): void {
    this.record({
      name,
      type: MetricType.COUNTER,
      help: `Counter for ${name}`,
      labels,
      value,
      timestamp: new Date(),
    });
  }

  // Record a gauge metric
  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    this.record({
      name,
      type: MetricType.GAUGE,
      help: `Gauge for ${name}`,
      labels,
      value,
      timestamp: new Date(),
    });
  }

  // Record a histogram metric
  histogram(name: string, value: number, labels: MetricLabels = {}): void {
    this.record({
      name,
      type: MetricType.HISTOGRAM,
      help: `Histogram for ${name}`,
      labels,
      value,
      timestamp: new Date(),
    });
  }

  // Record timing metric
  timing(name: string, duration: number, labels: MetricLabels = {}): void {
    this.histogram(`${name}_duration_ms`, duration, labels);
  }

  // Record a metric
  private record(metric: Metric): void {
    const key = this.getMetricKey(metric.name, metric.labels);
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    const metrics = this.metrics.get(key)!;
    metrics.push(metric);

    // Limit metrics per type
    if (metrics.length > this.config.maxMetricsPerType) {
      metrics.shift();
    }
  }

  // Get metric key with labels
  private getMetricKey(name: string, labels: MetricLabels): string {
    const labelPairs = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    
    return labelPairs ? `${name}{${labelPairs}}` : name;
  }

  // Get current value of a metric
  getValue(name: string, labels: MetricLabels = {}): number | null {
    const key = this.getMetricKey(name, labels);
    const metrics = this.metrics.get(key);
    
    if (!metrics || metrics.length === 0) {
      return null;
    }

    return metrics[metrics.length - 1].value;
  }

  // Get metric history
  getHistory(name: string, labels: MetricLabels = {}, duration?: number): Metric[] {
    const key = this.getMetricKey(name, labels);
    const metrics = this.metrics.get(key) || [];
    
    if (!duration) {
      return metrics;
    }

    const cutoff = new Date(Date.now() - duration);
    return metrics.filter(m => m.timestamp >= cutoff);
  }

  // Get all metrics
  getAllMetrics(): Map<string, Metric[]> {
    return new Map(this.metrics);
  }

  // Clean up old metrics
  private cleanup(): void {
    const cutoff = new Date(Date.now() - this.config.retentionPeriod);
    
    for (const [key, metrics] of this.metrics.entries()) {
      const filtered = metrics.filter(m => m.timestamp >= cutoff);
      
      if (filtered.length === 0) {
        this.metrics.delete(key);
      } else {
        this.metrics.set(key, filtered);
      }
    }
  }

  // Export metrics in Prometheus format
  exportPrometheus(): string {
    const lines: string[] = [];
    const processedMetrics = new Set<string>();

    for (const [key, metrics] of this.metrics.entries()) {
      if (metrics.length === 0) continue;
      
      const latestMetric = metrics[metrics.length - 1];
      const metricName = latestMetric.name;
      
      // Add help text once per metric
      if (!processedMetrics.has(metricName)) {
        lines.push(`# HELP ${metricName} ${latestMetric.help}`);
        lines.push(`# TYPE ${metricName} ${latestMetric.type}`);
        processedMetrics.add(metricName);
      }
      
      // Add metric value
      lines.push(`${key} ${latestMetric.value} ${latestMetric.timestamp.getTime()}`);
    }

    return lines.join('\n');
  }
}

/**
 * Alert Manager
 * Manages alerts and notifications
 */
export class AlertManager extends EventEmitter {
  private alerts: Map<string, Alert> = new Map();
  private metrics: MetricsCollector;
  private checkInterval?: NodeJS.Timeout;

  constructor(metrics: MetricsCollector, checkInterval: number = 30000) {
    super();
    this.metrics = metrics;
    
    // Start alert checking
    this.checkInterval = setInterval(() => this.checkAlerts(), checkInterval);
  }

  // Register an alert
  registerAlert(alert: Alert): void {
    this.alerts.set(alert.id, alert);
  }

  // Remove an alert
  removeAlert(alertId: string): void {
    this.alerts.delete(alertId);
  }

  // Check all alerts
  private checkAlerts(): void {
    for (const alert of this.alerts.values()) {
      this.checkAlert(alert);
    }
  }

  // Check a single alert
  private checkAlert(alert: Alert): void {
    const value = this.metrics.getValue(alert.condition.metric);
    
    if (value === null) return;

    const conditionMet = this.evaluateCondition(
      value,
      alert.condition.operator,
      alert.condition.threshold
    );

    if (conditionMet && !alert.triggered) {
      // Alert triggered
      alert.triggered = true;
      alert.triggeredAt = new Date();
      this.emit('alert:triggered', alert);
    } else if (!conditionMet && alert.triggered) {
      // Alert resolved
      alert.triggered = false;
      alert.resolvedAt = new Date();
      this.emit('alert:resolved', alert);
    }
  }

  // Evaluate alert condition
  private evaluateCondition(
    value: number,
    operator: string,
    threshold: number
  ): boolean {
    switch (operator) {
      case '>': return value > threshold;
      case '<': return value < threshold;
      case '>=': return value >= threshold;
      case '<=': return value <= threshold;
      case '==': return value === threshold;
      case '!=': return value !== threshold;
      default: return false;
    }
  }

  // Get all alerts
  getAlerts(): Alert[] {
    return Array.from(this.alerts.values());
  }

  // Get triggered alerts
  getTriggeredAlerts(): Alert[] {
    return this.getAlerts().filter(a => a.triggered);
  }

  // Stop alert checking
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

/**
 * Health Monitor
 * Monitors system and component health
 */
export class HealthMonitor {
  private checks: Map<string, () => Promise<HealthCheck>> = new Map();
  private lastCheckResults: Map<string, HealthCheck> = new Map();
  private checkInterval?: NodeJS.Timeout;

  constructor(checkInterval: number = 60000) {
    // Start periodic health checks
    this.checkInterval = setInterval(() => this.runHealthChecks(), checkInterval);
  }

  // Register a health check
  register(name: string, check: () => Promise<HealthCheck>): void {
    this.checks.set(name, check);
  }

  // Run all health checks
  async runHealthChecks(): Promise<Map<string, HealthCheck>> {
    const results = new Map<string, HealthCheck>();

    for (const [name, check] of this.checks.entries()) {
      try {
        const startTime = Date.now();
        const result = await check();
        result.latency = Date.now() - startTime;
        results.set(name, result);
        this.lastCheckResults.set(name, result);
      } catch (error) {
        const errorResult: HealthCheck = {
          name,
          status: HealthStatus.UNHEALTHY,
          message: error instanceof Error ? error.message : 'Health check failed',
        };
        results.set(name, errorResult);
        this.lastCheckResults.set(name, errorResult);
      }
    }

    return results;
  }

  // Get overall system health
  async getSystemHealth(): Promise<{
    status: HealthStatus;
    checks: HealthCheck[];
    timestamp: Date;
  }> {
    const results = await this.runHealthChecks();
    const checks = Array.from(results.values());
    
    // Determine overall status
    const hasUnhealthy = checks.some(c => c.status === HealthStatus.UNHEALTHY);
    const hasDegraded = checks.some(c => c.status === HealthStatus.DEGRADED);
    
    const status = hasUnhealthy ? HealthStatus.UNHEALTHY :
                   hasDegraded ? HealthStatus.DEGRADED :
                   HealthStatus.HEALTHY;

    return {
      status,
      checks,
      timestamp: new Date(),
    };
  }

  // Get last check results
  getLastResults(): Map<string, HealthCheck> {
    return new Map(this.lastCheckResults);
  }

  // Stop health monitoring
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

/**
 * Main Monitoring Service
 * Orchestrates metrics, alerts, and health monitoring
 */
export class MonitoringService {
  private static instance: MonitoringService;
  public readonly metrics: MetricsCollector;
  public readonly alerts: AlertManager;
  public readonly health: HealthMonitor;
  private logger: Logger;

  constructor(config?: Partial<MonitoringConfig>) {
    this.metrics = new MetricsCollector(config);
    this.alerts = new AlertManager(this.metrics);
    this.health = new HealthMonitor();
    this.logger = new Logger({ service: 'monitoring' });

    this.setupDefaultAlerts();
    this.setupDefaultHealthChecks();
    this.setupAlertHandlers();
  }

  static getInstance(config?: Partial<MonitoringConfig>): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService(config);
    }
    return MonitoringService.instance;
  }

  // Setup default alerts
  private setupDefaultAlerts(): void {
    // High error rate alert
    this.alerts.registerAlert({
      id: 'high_error_rate',
      name: 'High Error Rate',
      condition: {
        metric: 'http_requests_errors_total',
        operator: '>',
        threshold: 100,
        duration: 300, // 5 minutes
        severity: AlertSeverity.ERROR,
      },
      message: 'Error rate is above threshold',
      severity: AlertSeverity.ERROR,
      triggered: false,
    });

    // High response time alert
    this.alerts.registerAlert({
      id: 'high_response_time',
      name: 'High Response Time',
      condition: {
        metric: 'http_request_duration_ms',
        operator: '>',
        threshold: 1000,
        duration: 300,
        severity: AlertSeverity.WARNING,
      },
      message: 'Response time is above 1 second',
      severity: AlertSeverity.WARNING,
      triggered: false,
    });

    // High memory usage alert
    this.alerts.registerAlert({
      id: 'high_memory_usage',
      name: 'High Memory Usage',
      condition: {
        metric: 'process_memory_usage_bytes',
        operator: '>',
        threshold: 500 * 1024 * 1024, // 500MB
        severity: AlertSeverity.WARNING,
      },
      message: 'Memory usage is above 500MB',
      severity: AlertSeverity.WARNING,
      triggered: false,
    });
  }

  // Setup default health checks
  private setupDefaultHealthChecks(): void {
    // Database health check
    this.health.register('database', async () => {
      try {
        // Import prisma lazily to avoid circular dependencies
        const { prisma } = await import('@/lib/prisma');
        const startTime = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        const latency = Date.now() - startTime;

        return {
          name: 'database',
          status: latency < 100 ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
          latency,
          message: `Database response time: ${latency}ms`,
        };
      } catch (error) {
        return {
          name: 'database',
          status: HealthStatus.UNHEALTHY,
          message: error instanceof Error ? error.message : 'Database connection failed',
        };
      }
    });

    // Redis health check
    this.health.register('redis', async () => {
      try {
        // Import cache manager lazily
        const { cacheManager } = await import('@/lib/services/cache/cache-manager');
        const health = await cacheManager.healthCheck();
        
        return {
          name: 'redis',
          status: health.redis ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
          message: health.redis ? 'Redis is operational' : 'Redis connection failed',
          metadata: health.details,
        };
      } catch (error) {
        return {
          name: 'redis',
          status: HealthStatus.UNHEALTHY,
          message: 'Redis health check failed',
        };
      }
    });

    // Memory health check
    this.health.register('memory', async () => {
      const usage = process.memoryUsage();
      const heapUsedMB = usage.heapUsed / 1024 / 1024;
      const heapTotalMB = usage.heapTotal / 1024 / 1024;
      const percentage = (heapUsedMB / heapTotalMB) * 100;

      return {
        name: 'memory',
        status: percentage > 90 ? HealthStatus.UNHEALTHY :
                percentage > 70 ? HealthStatus.DEGRADED :
                HealthStatus.HEALTHY,
        message: `Heap usage: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (${percentage.toFixed(1)}%)`,
        metadata: usage,
      };
    });
  }

  // Setup alert handlers
  private setupAlertHandlers(): void {
    this.alerts.on('alert:triggered', (alert: Alert) => {
      this.logger.error(`Alert triggered: ${alert.name}`, undefined, {
        alert: alert.id,
        severity: alert.severity,
        condition: alert.condition,
      });

      // Send notifications based on severity
      if (alert.severity === AlertSeverity.CRITICAL) {
        this.sendCriticalAlert(alert);
      }
    });

    this.alerts.on('alert:resolved', (alert: Alert) => {
      this.logger.info(`Alert resolved: ${alert.name}`, {
        alert: alert.id,
        duration: alert.triggeredAt && alert.resolvedAt
          ? alert.resolvedAt.getTime() - alert.triggeredAt.getTime()
          : 0,
      });
    });
  }

  // Send critical alert notification
  private async sendCriticalAlert(alert: Alert): Promise<void> {
    // This would integrate with notification services
    // For now, just log it
    this.logger.fatal(`CRITICAL ALERT: ${alert.name}`, undefined, {
      alert,
      action: 'Immediate attention required',
    });
  }

  // Record an error
  recordError(error: Error | AppError, context?: Record<string, any>): void {
    this.metrics.increment('errors_total', 1, {
      type: error.name,
      severity: error instanceof AppError ? error.severity : ErrorSeverity.MEDIUM,
    });

    if (error instanceof AppError && error.severity === ErrorSeverity.CRITICAL) {
      this.metrics.increment('critical_errors_total');
    }
  }

  // Record HTTP request
  recordHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number
  ): void {
    this.metrics.increment('http_requests_total', 1, {
      method,
      path,
      status: statusCode,
    });

    this.metrics.histogram('http_request_duration_ms', duration, {
      method,
      path,
      status: statusCode,
    });

    if (statusCode >= 400) {
      this.metrics.increment('http_requests_errors_total', 1, {
        method,
        path,
        status: statusCode,
      });
    }
  }

  // Record database query
  recordDatabaseQuery(
    operation: string,
    duration: number,
    success: boolean
  ): void {
    this.metrics.increment('database_queries_total', 1, {
      operation,
      success: success ? 'true' : 'false',
    });

    this.metrics.histogram('database_query_duration_ms', duration, {
      operation,
      success: success ? 'true' : 'false',
    });

    if (!success) {
      this.metrics.increment('database_errors_total', 1, {
        operation,
      });
    }
  }

  // Record cache operation
  recordCacheOperation(
    operation: 'get' | 'set' | 'delete',
    hit: boolean,
    duration: number
  ): void {
    this.metrics.increment('cache_operations_total', 1, {
      operation,
      hit: hit ? 'true' : 'false',
    });

    this.metrics.histogram('cache_operation_duration_ms', duration, {
      operation,
      hit: hit ? 'true' : 'false',
    });

    if (operation === 'get') {
      this.metrics.increment(hit ? 'cache_hits_total' : 'cache_misses_total');
    }
  }

  // Get monitoring dashboard data
  async getDashboardData(): Promise<{
    metrics: Record<string, any>;
    alerts: Alert[];
    health: any;
  }> {
    const health = await this.health.getSystemHealth();
    
    return {
      metrics: {
        errors: {
          total: this.metrics.getValue('errors_total') || 0,
          critical: this.metrics.getValue('critical_errors_total') || 0,
          rate: this.calculateRate('errors_total', 300000), // 5 min
        },
        requests: {
          total: this.metrics.getValue('http_requests_total') || 0,
          errors: this.metrics.getValue('http_requests_errors_total') || 0,
          rate: this.calculateRate('http_requests_total', 60000), // 1 min
        },
        performance: {
          avgResponseTime: this.calculateAverage('http_request_duration_ms', 300000),
          avgDbQueryTime: this.calculateAverage('database_query_duration_ms', 300000),
        },
        cache: {
          hits: this.metrics.getValue('cache_hits_total') || 0,
          misses: this.metrics.getValue('cache_misses_total') || 0,
          hitRate: this.calculateCacheHitRate(),
        },
      },
      alerts: this.alerts.getTriggeredAlerts(),
      health,
    };
  }

  // Calculate rate of change
  private calculateRate(metric: string, duration: number): number {
    const history = this.metrics.getHistory(metric, {}, duration);
    if (history.length < 2) return 0;

    const first = history[0];
    const last = history[history.length - 1];
    const timeDiff = (last.timestamp.getTime() - first.timestamp.getTime()) / 1000;
    
    return timeDiff > 0 ? (last.value - first.value) / timeDiff : 0;
  }

  // Calculate average
  private calculateAverage(metric: string, duration: number): number {
    const history = this.metrics.getHistory(metric, {}, duration);
    if (history.length === 0) return 0;

    const sum = history.reduce((acc, m) => acc + m.value, 0);
    return sum / history.length;
  }

  // Calculate cache hit rate
  private calculateCacheHitRate(): number {
    const hits = this.metrics.getValue('cache_hits_total') || 0;
    const misses = this.metrics.getValue('cache_misses_total') || 0;
    const total = hits + misses;
    
    return total > 0 ? (hits / total) * 100 : 0;
  }

  // Shutdown monitoring
  shutdown(): void {
    this.alerts.stop();
    this.health.stop();
  }
}

// Export singleton instance
export const monitoring = MonitoringService.getInstance();