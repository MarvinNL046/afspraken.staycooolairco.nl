import { cacheService, CacheStats } from './redis-cache.service';
import { geocodingCache } from './geocoding-cache';
import { availabilityCache } from './availability-cache';
import { routeCache } from './route-cache';
import { DutchAddress, LatLng, TravelMode, RouteResponse } from '@/types/google-maps';
import { TimeSlotWithAvailability } from '@/lib/types';
import cron from 'node-cron';

/**
 * Unified Cache Manager
 * Coordinates all cache services and implements intelligent warming strategies
 */
export class CacheManager {
  private static instance: CacheManager;
  private warmingSchedule: cron.ScheduledTask | null = null;
  private initialized = false;

  private constructor() {}

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  /**
   * Initialize cache system
   */
  async initialize(redisUrl?: string): Promise<void> {
    if (this.initialized) {
      console.log('[CacheManager] Already initialized');
      return;
    }

    console.log('[CacheManager] Initializing cache system...');

    try {
      // Initialize Redis connection
      await cacheService.initialize(redisUrl);

      // Schedule cache warming
      this.scheduleWarmingTasks();

      // Run initial warming
      await this.runInitialWarming();

      this.initialized = true;
      console.log('[CacheManager] Cache system initialized successfully');
    } catch (error) {
      console.error('[CacheManager] Failed to initialize cache system:', error);
      throw error;
    }
  }

  /**
   * Schedule periodic cache warming tasks
   */
  private scheduleWarmingTasks(): void {
    // Run cache warming every 4 hours
    this.warmingSchedule = cron.schedule('0 */4 * * *', async () => {
      console.log('[CacheManager] Running scheduled cache warming...');
      await this.warmAllCaches();
    });

    // Additional warming at peak times (8 AM and 6 PM)
    cron.schedule('0 8,18 * * *', async () => {
      console.log('[CacheManager] Running peak-time cache warming...');
      await this.warmPeakTimeCaches();
    });

    // Availability cache warming every morning at 6 AM
    cron.schedule('0 6 * * *', async () => {
      console.log('[CacheManager] Running morning availability warming...');
      await availabilityCache.warmCache();
    });

    console.log('[CacheManager] Cache warming scheduled');
  }

  /**
   * Run initial cache warming on startup
   */
  private async runInitialWarming(): Promise<void> {
    console.log('[CacheManager] Running initial cache warming...');

    // Run warming tasks in parallel
    const warmingTasks = [
      geocodingCache.warmCache(),
      availabilityCache.warmCache(),
      routeCache.warmCache(),
    ];

    const results = await Promise.allSettled(warmingTasks);

    results.forEach((result, index) => {
      const serviceName = ['Geocoding', 'Availability', 'Route'][index];
      if (result.status === 'rejected') {
        console.error(`[CacheManager] ${serviceName} warming failed:`, result.reason);
      }
    });
  }

  /**
   * Warm all caches
   */
  async warmAllCaches(): Promise<void> {
    const startTime = Date.now();

    try {
      await Promise.all([
        geocodingCache.warmCache(),
        availabilityCache.warmCache(),
        routeCache.warmCache(),
      ]);

      const duration = Date.now() - startTime;
      console.log(`[CacheManager] All caches warmed in ${duration}ms`);
    } catch (error) {
      console.error('[CacheManager] Error warming caches:', error);
    }
  }

  /**
   * Warm caches for peak times
   */
  private async warmPeakTimeCaches(): Promise<void> {
    // Focus on availability and frequently used routes
    await Promise.all([
      availabilityCache.warmCache(),
      this.warmPopularRoutes(),
    ]);
  }

  /**
   * Warm popular routes based on time of day
   */
  private async warmPopularRoutes(): Promise<void> {
    const hour = new Date().getHours();
    
    // Morning rush (7-9 AM): warm routes from service areas to common destinations
    if (hour >= 7 && hour <= 9) {
      console.log('[CacheManager] Warming morning rush routes...');
      // Implementation would warm specific morning routes
    }
    
    // Evening rush (5-7 PM): warm return routes
    else if (hour >= 17 && hour <= 19) {
      console.log('[CacheManager] Warming evening rush routes...');
      // Implementation would warm specific evening routes
    }
  }

  // === Geocoding Cache Methods ===

  async getGeocodingResult(address: DutchAddress | string) {
    return geocodingCache.get(address);
  }

  async setGeocodingResult(address: DutchAddress | string, result: any) {
    return geocodingCache.set(address, result);
  }

  async invalidateGeocoding(address: DutchAddress | string) {
    return geocodingCache.invalidate(address);
  }

  // === Availability Cache Methods ===

  async getAvailableSlots(date: Date): Promise<TimeSlotWithAvailability[] | null> {
    return availabilityCache.getAvailableSlots(date);
  }

  async setAvailableSlots(date: Date, slots: TimeSlotWithAvailability[]) {
    return availabilityCache.setAvailableSlots(date, slots);
  }

  async getAvailableDates(startDate: Date, endDate: Date): Promise<Date[] | null> {
    return availabilityCache.getAvailableDates(startDate, endDate);
  }

  async setAvailableDates(startDate: Date, endDate: Date, dates: Date[]) {
    return availabilityCache.setAvailableDates(startDate, endDate, dates);
  }

  async markSlotBooked(date: Date, time: string) {
    return availabilityCache.markSlotBooked(date, time);
  }

  async markSlotAvailable(date: Date, time: string) {
    return availabilityCache.markSlotAvailable(date, time);
  }

  async invalidateAvailability(date: Date) {
    return availabilityCache.invalidateDate(date);
  }

  // === Route Cache Methods ===

  async getRoute(
    origin: string | LatLng | DutchAddress,
    destination: string | LatLng | DutchAddress,
    travelMode: TravelMode = TravelMode.DRIVING,
    options?: { waypoints?: boolean; traffic?: boolean }
  ): Promise<RouteResponse | null> {
    return routeCache.getRoute(origin, destination, travelMode, options);
  }

  async setRoute(
    origin: string | LatLng | DutchAddress,
    destination: string | LatLng | DutchAddress,
    route: RouteResponse,
    travelMode: TravelMode = TravelMode.DRIVING,
    options?: { waypoints?: boolean; traffic?: boolean; ttl?: number }
  ) {
    return routeCache.setRoute(origin, destination, route, travelMode, options);
  }

  async getOptimizedRoute(
    origin: string | LatLng | DutchAddress,
    waypoints: (string | LatLng | DutchAddress)[],
    destination: string | LatLng | DutchAddress,
    travelMode: TravelMode = TravelMode.DRIVING
  ) {
    return routeCache.getOptimizedRoute(origin, waypoints, destination, travelMode);
  }

  async setOptimizedRoute(
    origin: string | LatLng | DutchAddress,
    waypoints: (string | LatLng | DutchAddress)[],
    destination: string | LatLng | DutchAddress,
    route: RouteResponse & { optimizedOrder: number[] },
    travelMode: TravelMode = TravelMode.DRIVING
  ) {
    return routeCache.setOptimizedRoute(origin, waypoints, destination, route, travelMode);
  }

  async getDistanceMatrix(
    origins: (string | LatLng | DutchAddress)[],
    destinations: (string | LatLng | DutchAddress)[],
    travelMode: TravelMode = TravelMode.DRIVING
  ) {
    return routeCache.getDistanceMatrix(origins, destinations, travelMode);
  }

  async setDistanceMatrix(
    origins: (string | LatLng | DutchAddress)[],
    destinations: (string | LatLng | DutchAddress)[],
    matrix: any,
    travelMode: TravelMode = TravelMode.DRIVING
  ) {
    return routeCache.setDistanceMatrix(origins, destinations, matrix, travelMode);
  }

  // === Global Cache Operations ===

  /**
   * Get comprehensive cache statistics
   */
  async getStats(): Promise<{
    overall: CacheStats;
    geocoding: any;
    availability: any;
    routes: any;
    performance: {
      hitRate: number;
      averageLatency: number;
      memoryUsage: number;
      redisKeys: number;
    };
  }> {
    const [overall, geocoding, availability, routes] = await Promise.all([
      cacheService.getStats(),
      geocodingCache.getStats(),
      availabilityCache.getStats(),
      routeCache.getStats(),
    ]);

    // Calculate performance metrics
    const metrics = cacheService.getMetrics();
    const avgLatency = metrics.length > 0
      ? metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length
      : 0;

    return {
      overall,
      geocoding,
      availability,
      routes,
      performance: {
        hitRate: overall.hitRate,
        averageLatency: Math.round(avgLatency),
        memoryUsage: overall.memoryUsage,
        redisKeys: overall.redisKeys,
      },
    };
  }

  /**
   * Clear all caches
   */
  async flushAll(): Promise<void> {
    console.log('[CacheManager] Flushing all caches...');
    await cacheService.flush();
  }

  /**
   * Clear specific cache type
   */
  async flushCache(type: 'geocoding' | 'availability' | 'routes'): Promise<void> {
    console.log(`[CacheManager] Flushing ${type} cache...`);
    
    switch (type) {
      case 'geocoding':
        await cacheService.deletePattern('geo:*');
        break;
      case 'availability':
        await availabilityCache.flush();
        break;
      case 'routes':
        await cacheService.deletePattern('route:*');
        break;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[CacheManager] Shutting down cache system...');

    // Stop scheduled tasks
    if (this.warmingSchedule) {
      this.warmingSchedule.stop();
    }

    // Shutdown Redis connection
    await cacheService.shutdown();

    this.initialized = false;
    console.log('[CacheManager] Cache system shut down');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    redis: boolean;
    details: any;
  }> {
    try {
      // Try a simple Redis operation
      await cacheService.set('health:check', Date.now(), { ttl: 60 });
      const value = await cacheService.get<number>('health:check');
      
      const stats = await this.getStats();
      
      return {
        status: value ? 'healthy' : 'degraded',
        redis: !!value,
        details: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          cacheStats: stats.performance,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        redis: false,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

// Export singleton instance
export const cacheManager = CacheManager.getInstance();

// Export cache services for direct access if needed
export { cacheService, geocodingCache, availabilityCache, routeCache };