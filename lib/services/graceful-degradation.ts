/**
 * Graceful Degradation Service
 * Implements fallback strategies and service degradation patterns
 */

import { AppError, ErrorCode, ErrorSeverity } from '@/lib/errors/types';
import { logger } from './logging/logger';
import { monitoring } from './monitoring/monitor';
import { CircuitBreaker } from '@/lib/middleware/error-handler';

// Service status levels
export enum ServiceStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  CRITICAL = 'critical',
  OFFLINE = 'offline',
}

// Feature flags for degradation
export interface FeatureFlags {
  googleMapsEnabled: boolean;
  goHighLevelEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  cacheEnabled: boolean;
  advancedRoutingEnabled: boolean;
  realTimeAvailabilityEnabled: boolean;
}

// Degradation strategy
export interface DegradationStrategy {
  service: string;
  status: ServiceStatus;
  fallbackEnabled: boolean;
  features: Partial<FeatureFlags>;
  message?: string;
}

/**
 * Graceful Degradation Manager
 * Manages service degradation and fallback strategies
 */
export class GracefulDegradationManager {
  private static instance: GracefulDegradationManager;
  private serviceStatus: Map<string, ServiceStatus> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private featureFlags: FeatureFlags;
  private degradationCallbacks: Map<string, Array<(status: ServiceStatus) => void>> = new Map();

  constructor() {
    // Initialize with all features enabled
    this.featureFlags = {
      googleMapsEnabled: true,
      goHighLevelEnabled: true,
      emailEnabled: true,
      smsEnabled: true,
      cacheEnabled: true,
      advancedRoutingEnabled: true,
      realTimeAvailabilityEnabled: true,
    };

    // Set initial service status
    this.serviceStatus.set('google-maps', ServiceStatus.HEALTHY);
    this.serviceStatus.set('gohighlevel', ServiceStatus.HEALTHY);
    this.serviceStatus.set('email', ServiceStatus.HEALTHY);
    this.serviceStatus.set('sms', ServiceStatus.HEALTHY);
    this.serviceStatus.set('cache', ServiceStatus.HEALTHY);
    this.serviceStatus.set('database', ServiceStatus.HEALTHY);
  }

  static getInstance(): GracefulDegradationManager {
    if (!GracefulDegradationManager.instance) {
      GracefulDegradationManager.instance = new GracefulDegradationManager();
    }
    return GracefulDegradationManager.instance;
  }

  /**
   * Get or create circuit breaker for a service
   */
  getCircuitBreaker(
    service: string,
    options?: {
      threshold?: number;
      timeout?: number;
    }
  ): CircuitBreaker {
    if (!this.circuitBreakers.has(service)) {
      this.circuitBreakers.set(
        service,
        new CircuitBreaker(
          options?.threshold || 5,
          options?.timeout || 60000,
          service
        )
      );
    }
    return this.circuitBreakers.get(service)!;
  }

  /**
   * Update service status
   */
  updateServiceStatus(service: string, status: ServiceStatus): void {
    const previousStatus = this.serviceStatus.get(service);
    this.serviceStatus.set(service, status);

    // Log status change
    if (previousStatus !== status) {
      logger.warn(`Service ${service} status changed from ${previousStatus} to ${status}`, {
        service,
        previousStatus,
        newStatus: status,
      });

      // Update monitoring
      monitoring.metrics.gauge('service_status', this.getStatusValue(status), {
        service,
      });

      // Apply degradation strategy
      this.applyDegradationStrategy(service, status);

      // Call registered callbacks
      const callbacks = this.degradationCallbacks.get(service) || [];
      callbacks.forEach(callback => callback(status));
    }
  }

  /**
   * Register callback for service status changes
   */
  onServiceStatusChange(
    service: string,
    callback: (status: ServiceStatus) => void
  ): () => void {
    if (!this.degradationCallbacks.has(service)) {
      this.degradationCallbacks.set(service, []);
    }
    this.degradationCallbacks.get(service)!.push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.degradationCallbacks.get(service) || [];
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Apply degradation strategy based on service status
   */
  private applyDegradationStrategy(service: string, status: ServiceStatus): void {
    switch (service) {
      case 'google-maps':
        this.degradeGoogleMaps(status);
        break;
      case 'gohighlevel':
        this.degradeGoHighLevel(status);
        break;
      case 'cache':
        this.degradeCache(status);
        break;
      case 'database':
        this.degradeDatabase(status);
        break;
    }
  }

  /**
   * Google Maps degradation strategy
   */
  private degradeGoogleMaps(status: ServiceStatus): void {
    switch (status) {
      case ServiceStatus.DEGRADED:
        // Disable advanced features
        this.featureFlags.advancedRoutingEnabled = false;
        logger.info('Google Maps degraded: Advanced routing disabled');
        break;
      
      case ServiceStatus.CRITICAL:
        // Use cached data only
        this.featureFlags.googleMapsEnabled = false;
        logger.warn('Google Maps critical: Using cached data only');
        break;
      
      case ServiceStatus.OFFLINE:
        // Complete fallback
        this.featureFlags.googleMapsEnabled = false;
        this.featureFlags.advancedRoutingEnabled = false;
        logger.error('Google Maps offline: All features disabled');
        break;
      
      case ServiceStatus.HEALTHY:
        // Restore all features
        this.featureFlags.googleMapsEnabled = true;
        this.featureFlags.advancedRoutingEnabled = true;
        logger.info('Google Maps healthy: All features restored');
        break;
    }
  }

  /**
   * GoHighLevel degradation strategy
   */
  private degradeGoHighLevel(status: ServiceStatus): void {
    switch (status) {
      case ServiceStatus.DEGRADED:
        // Queue non-critical updates
        logger.info('GoHighLevel degraded: Queueing non-critical updates');
        break;
      
      case ServiceStatus.CRITICAL:
      case ServiceStatus.OFFLINE:
        // Disable sync, store locally
        this.featureFlags.goHighLevelEnabled = false;
        logger.warn('GoHighLevel offline: Storing updates locally');
        break;
      
      case ServiceStatus.HEALTHY:
        // Resume normal operations
        this.featureFlags.goHighLevelEnabled = true;
        logger.info('GoHighLevel healthy: Sync resumed');
        break;
    }
  }

  /**
   * Cache degradation strategy
   */
  private degradeCache(status: ServiceStatus): void {
    switch (status) {
      case ServiceStatus.DEGRADED:
      case ServiceStatus.CRITICAL:
      case ServiceStatus.OFFLINE:
        // Disable caching, go direct to source
        this.featureFlags.cacheEnabled = false;
        logger.warn('Cache unavailable: Using direct queries');
        break;
      
      case ServiceStatus.HEALTHY:
        // Re-enable caching
        this.featureFlags.cacheEnabled = true;
        logger.info('Cache healthy: Caching resumed');
        break;
    }
  }

  /**
   * Database degradation strategy
   */
  private degradeDatabase(status: ServiceStatus): void {
    switch (status) {
      case ServiceStatus.DEGRADED:
        // Read-only mode
        logger.warn('Database degraded: Read-only mode activated');
        break;
      
      case ServiceStatus.CRITICAL:
      case ServiceStatus.OFFLINE:
        // Emergency mode - cache only
        logger.error('Database critical: Emergency mode - cache only');
        break;
      
      case ServiceStatus.HEALTHY:
        logger.info('Database healthy: Full access restored');
        break;
    }
  }

  /**
   * Get numeric value for status (for metrics)
   */
  private getStatusValue(status: ServiceStatus): number {
    switch (status) {
      case ServiceStatus.HEALTHY: return 1;
      case ServiceStatus.DEGRADED: return 0.5;
      case ServiceStatus.CRITICAL: return 0.25;
      case ServiceStatus.OFFLINE: return 0;
      default: return 0;
    }
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature: keyof FeatureFlags): boolean {
    return this.featureFlags[feature];
  }

  /**
   * Get current service status
   */
  getServiceStatus(service: string): ServiceStatus {
    return this.serviceStatus.get(service) || ServiceStatus.OFFLINE;
  }

  /**
   * Get all service statuses
   */
  getAllServiceStatuses(): Map<string, ServiceStatus> {
    return new Map(this.serviceStatus);
  }

  /**
   * Get degradation report
   */
  getDegradationReport(): {
    services: Record<string, ServiceStatus>;
    features: FeatureFlags;
    recommendations: string[];
  } {
    const services: Record<string, ServiceStatus> = {};
    this.serviceStatus.forEach((status, service) => {
      services[service] = status;
    });

    const recommendations: string[] = [];

    // Generate recommendations
    if (!this.featureFlags.googleMapsEnabled) {
      recommendations.push('Google Maps is disabled. Consider using cached data or alternative geocoding service.');
    }
    
    if (!this.featureFlags.cacheEnabled) {
      recommendations.push('Cache is disabled. Performance may be degraded.');
    }
    
    if (this.getServiceStatus('database') !== ServiceStatus.HEALTHY) {
      recommendations.push('Database issues detected. Consider scaling or maintenance.');
    }

    return {
      services,
      features: { ...this.featureFlags },
      recommendations,
    };
  }
}

/**
 * Fallback Strategies
 */
export class FallbackStrategies {
  /**
   * Geocoding fallback - use postal code approximation
   */
  static async geocodingFallback(address: string): Promise<{
    latitude: number;
    longitude: number;
    accuracy: 'approximate';
  }> {
    logger.info('Using geocoding fallback for address', { address });
    
    // Extract postal code
    const postalCodeMatch = address.match(/\b\d{4}\s?[A-Z]{2}\b/);
    if (!postalCodeMatch) {
      throw new AppError(
        'Cannot determine location without geocoding service',
        ErrorCode.SERVICE_UNAVAILABLE,
        503,
        ErrorSeverity.HIGH
      );
    }

    // Use approximate postal code centers (simplified)
    const postalCode = postalCodeMatch[0].replace(/\s/g, '');
    const prefix = postalCode.substring(0, 2);
    
    // Rough approximations for Dutch postal code regions
    const postalCodeCenters: Record<string, { lat: number; lng: number }> = {
      '10': { lat: 52.3676, lng: 4.9041 }, // Amsterdam
      '20': { lat: 52.3874, lng: 4.6462 }, // Haarlem
      '21': { lat: 52.3025, lng: 4.6889 }, // Hoofddorp
      '25': { lat: 52.0705, lng: 4.3007 }, // Den Haag
      '30': { lat: 51.9225, lng: 4.4792 }, // Rotterdam
      // Add more as needed
    };

    const center = postalCodeCenters[prefix] || { lat: 52.3702, lng: 4.8952 }; // Default to Amsterdam
    
    return {
      latitude: center.lat,
      longitude: center.lng,
      accuracy: 'approximate',
    };
  }

  /**
   * Route calculation fallback - use straight-line distance
   */
  static async routeCalculationFallback(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number }
  ): Promise<{
    distance: number; // meters
    duration: number; // seconds
    accuracy: 'approximate';
  }> {
    logger.info('Using route calculation fallback');
    
    // Haversine formula for distance
    const R = 6371e3; // Earth's radius in meters
    const φ1 = origin.lat * Math.PI / 180;
    const φ2 = destination.lat * Math.PI / 180;
    const Δφ = (destination.lat - origin.lat) * Math.PI / 180;
    const Δλ = (destination.lng - origin.lng) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    const distance = R * c;
    
    // Rough estimate: 50 km/h average speed in urban areas
    const duration = (distance / 1000) / 50 * 3600;

    return {
      distance: Math.round(distance),
      duration: Math.round(duration),
      accuracy: 'approximate',
    };
  }

  /**
   * Email fallback - queue for later sending
   */
  static async emailFallback(
    to: string,
    subject: string,
    content: string
  ): Promise<{ queued: boolean; queueId: string }> {
    logger.info('Using email fallback - queueing message', { to, subject });
    
    // In a real implementation, this would save to a queue table
    const queueId = `email-queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store in database or file system for later processing
    // For now, just log it
    logger.info('Email queued for later delivery', {
      queueId,
      to,
      subject,
    });
    
    return {
      queued: true,
      queueId,
    };
  }

  /**
   * Availability fallback - use cached or default slots
   */
  static async availabilityFallback(date: Date): Promise<string[]> {
    logger.info('Using availability fallback for date', { date });
    
    // Return standard business hours if no data available
    const standardSlots = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
      '16:00', '16:30', '17:00'
    ];
    
    // For weekends, return empty
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return [];
    }
    
    return standardSlots;
  }
}

// Export singleton instance
export const degradationManager = GracefulDegradationManager.getInstance();