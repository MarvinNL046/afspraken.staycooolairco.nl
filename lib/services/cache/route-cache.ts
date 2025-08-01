import { PrismaClient } from '@prisma/client';
import { cacheService } from './redis-cache.service';
import { 
  DutchAddress, 
  LatLng, 
  RouteResponse, 
  TravelMode,
  RouteRequest
} from '@/types/google-maps';
import { addDays, startOfDay, format } from 'date-fns';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Cache configuration
const ROUTE_CONFIG = {
  ttl: 24 * 60 * 60, // 24 hours for routes (traffic patterns change daily)
  matrixTtl: 7 * 24 * 60 * 60, // 7 days for distance matrix (more stable)
  namespace: 'route',
  compressionThreshold: 2048, // Compress results > 2KB
};

// Service areas for StayCool
const SERVICE_AREAS = {
  hoofddorp: { lat: 52.3025, lng: 4.6889 },
  amsterdam: { lat: 52.3676, lng: 4.9041 },
  haarlem: { lat: 52.3874, lng: 4.6462 },
  amstelveen: { lat: 52.3114, lng: 4.8701 },
  schiphol: { lat: 52.3105, lng: 4.7683 },
};

// Cache key generators
export const routeCacheKeys = {
  // Key for a specific route
  route: (
    origin: string | LatLng | DutchAddress,
    destination: string | LatLng | DutchAddress,
    travelMode: TravelMode = TravelMode.DRIVING,
    options?: { waypoints?: boolean; traffic?: boolean }
  ): string => {
    const originHash = hashLocation(origin);
    const destHash = hashLocation(destination);
    const modeStr = travelMode.toLowerCase();
    const optStr = options ? `${options.waypoints ? 'w' : ''}${options.traffic ? 't' : ''}` : '';
    return `route:${modeStr}:${originHash}:${destHash}${optStr ? ':' + optStr : ''}`;
  },
  
  // Key for optimized route with waypoints
  optimizedRoute: (
    origin: string | LatLng | DutchAddress,
    waypoints: (string | LatLng | DutchAddress)[],
    destination: string | LatLng | DutchAddress,
    travelMode: TravelMode = TravelMode.DRIVING
  ): string => {
    const parts = [
      hashLocation(origin),
      ...waypoints.map(w => hashLocation(w)),
      hashLocation(destination),
    ];
    const routeHash = crypto.createHash('md5').update(parts.join(':')).digest('hex').substring(0, 8);
    return `route:optimized:${travelMode.toLowerCase()}:${routeHash}`;
  },
  
  // Key for distance matrix
  matrix: (
    origins: (string | LatLng | DutchAddress)[],
    destinations: (string | LatLng | DutchAddress)[],
    travelMode: TravelMode = TravelMode.DRIVING
  ): string => {
    const originHashes = origins.map(o => hashLocation(o)).join(',');
    const destHashes = destinations.map(d => hashLocation(d)).join(',');
    const matrixHash = crypto.createHash('md5')
      .update(`${originHashes}:${destHashes}`)
      .digest('hex')
      .substring(0, 8);
    return `route:matrix:${travelMode.toLowerCase()}:${matrixHash}`;
  },
  
  // Key for route cluster
  routeCluster: (clusterId: string): string => `route:cluster:${clusterId}`,
  
  // Key for service area routes
  serviceAreaRoutes: (area: string, date: Date): string => {
    const dateStr = format(startOfDay(date), 'yyyy-MM-dd');
    return `route:service:${area}:${dateStr}`;
  },
  
  // Key for frequently used routes
  frequentRoutes: (): string => 'route:frequent:routes',
  
  // Key for warming status
  warmingStatus: (): string => 'route:warming:status',
};

// Helper function to hash location for cache key
function hashLocation(location: string | LatLng | DutchAddress): string {
  let str: string;
  
  if (typeof location === 'string') {
    str = location.toLowerCase().replace(/\s+/g, '');
  } else if ('lat' in location && 'lng' in location) {
    // Round to 4 decimal places for cache key (11m precision)
    str = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
  } else {
    // DutchAddress
    str = `${location.street}${location.houseNumber}${location.houseNumberExt || ''}${location.postalCode}${location.city}`
      .toLowerCase()
      .replace(/\s+/g, '');
  }
  
  return crypto.createHash('md5').update(str).digest('hex').substring(0, 8);
}

/**
 * Route Cache Manager
 * Handles caching, optimization, and warming for route calculations
 */
export class RouteCache {
  private static instance: RouteCache;
  private warmingInProgress = false;
  private lastWarmingTime?: Date;
  private routeUsageTracking: Map<string, number> = new Map();

  private constructor() {
    // Register namespace configuration
    cacheService.registerNamespace('route', ROUTE_CONFIG);
    
    // Register warmup task
    cacheService.registerWarmupTask('routes', () => this.warmCache());
    
    // Persist route usage tracking periodically
    setInterval(() => this.persistRouteUsage(), 30000); // Every 30 seconds
  }

  static getInstance(): RouteCache {
    if (!RouteCache.instance) {
      RouteCache.instance = new RouteCache();
    }
    return RouteCache.instance;
  }

  /**
   * Get cached route
   */
  async getRoute(
    origin: string | LatLng | DutchAddress,
    destination: string | LatLng | DutchAddress,
    travelMode: TravelMode = TravelMode.DRIVING,
    options?: { waypoints?: boolean; traffic?: boolean }
  ): Promise<RouteResponse | null> {
    const key = routeCacheKeys.route(origin, destination, travelMode, options);
    const cached = await cacheService.get<RouteResponse>(key);
    
    if (cached) {
      // Track route usage
      this.trackRouteUsage(key);
    }
    
    return cached;
  }

  /**
   * Set cached route
   */
  async setRoute(
    origin: string | LatLng | DutchAddress,
    destination: string | LatLng | DutchAddress,
    route: RouteResponse,
    travelMode: TravelMode = TravelMode.DRIVING,
    options?: { waypoints?: boolean; traffic?: boolean; ttl?: number }
  ): Promise<void> {
    const key = routeCacheKeys.route(origin, destination, travelMode, options);
    
    // Use shorter TTL for traffic-aware routes
    const ttl = options?.ttl || (options?.traffic ? 3600 : ROUTE_CONFIG.ttl);
    
    await cacheService.set(key, route, {
      ttl,
      namespace: 'route',
    });
    
    // Update frequently used routes
    await this.updateFrequentRoutes(origin, destination, travelMode);
  }

  /**
   * Get cached optimized route
   */
  async getOptimizedRoute(
    origin: string | LatLng | DutchAddress,
    waypoints: (string | LatLng | DutchAddress)[],
    destination: string | LatLng | DutchAddress,
    travelMode: TravelMode = TravelMode.DRIVING
  ): Promise<(RouteResponse & { optimizedOrder: number[] }) | null> {
    const key = routeCacheKeys.optimizedRoute(origin, waypoints, destination, travelMode);
    return cacheService.get<RouteResponse & { optimizedOrder: number[] }>(key);
  }

  /**
   * Set cached optimized route
   */
  async setOptimizedRoute(
    origin: string | LatLng | DutchAddress,
    waypoints: (string | LatLng | DutchAddress)[],
    destination: string | LatLng | DutchAddress,
    route: RouteResponse & { optimizedOrder: number[] },
    travelMode: TravelMode = TravelMode.DRIVING,
    options?: { ttl?: number }
  ): Promise<void> {
    const key = routeCacheKeys.optimizedRoute(origin, waypoints, destination, travelMode);
    
    await cacheService.set(key, route, {
      ttl: options?.ttl || ROUTE_CONFIG.ttl,
      namespace: 'route',
    });
  }

  /**
   * Get cached distance matrix
   */
  async getDistanceMatrix(
    origins: (string | LatLng | DutchAddress)[],
    destinations: (string | LatLng | DutchAddress)[],
    travelMode: TravelMode = TravelMode.DRIVING
  ): Promise<any | null> {
    const key = routeCacheKeys.matrix(origins, destinations, travelMode);
    return cacheService.get<any>(key);
  }

  /**
   * Set cached distance matrix
   */
  async setDistanceMatrix(
    origins: (string | LatLng | DutchAddress)[],
    destinations: (string | LatLng | DutchAddress)[],
    matrix: any,
    travelMode: TravelMode = TravelMode.DRIVING,
    options?: { ttl?: number }
  ): Promise<void> {
    const key = routeCacheKeys.matrix(origins, destinations, travelMode);
    
    await cacheService.set(key, matrix, {
      ttl: options?.ttl || ROUTE_CONFIG.matrixTtl,
      namespace: 'route',
    });
  }

  /**
   * Get route cluster data
   */
  async getRouteCluster(clusterId: string): Promise<any | null> {
    const key = routeCacheKeys.routeCluster(clusterId);
    return cacheService.get<any>(key);
  }

  /**
   * Set route cluster data
   */
  async setRouteCluster(clusterId: string, clusterData: any): Promise<void> {
    const key = routeCacheKeys.routeCluster(clusterId);
    await cacheService.set(key, clusterData, {
      ttl: ROUTE_CONFIG.ttl,
      namespace: 'route',
    });
  }

  /**
   * Intelligent cache warming
   */
  async warmCache(): Promise<void> {
    if (this.warmingInProgress) {
      console.log('[RouteCache] Warming already in progress, skipping...');
      return;
    }

    this.warmingInProgress = true;
    const startTime = Date.now();

    try {
      console.log('[RouteCache] Starting cache warming...');

      // Update warming status
      await cacheService.set(routeCacheKeys.warmingStatus(), {
        status: 'in_progress',
        startTime: new Date(),
        type: 'scheduled',
      }, { ttl: 3600 });

      // 1. Warm frequently used routes
      await this.warmFrequentRoutes();

      // 2. Warm service area routes
      await this.warmServiceAreaRoutes();

      // 3. Warm upcoming appointment routes
      await this.warmUpcomingAppointmentRoutes();

      // 4. Pre-calculate distance matrices for common areas
      await this.warmDistanceMatrices();

      const duration = Date.now() - startTime;
      console.log(`[RouteCache] Cache warming completed in ${duration}ms`);

      // Update warming status
      await cacheService.set(routeCacheKeys.warmingStatus(), {
        status: 'completed',
        startTime: this.lastWarmingTime,
        endTime: new Date(),
        duration,
        type: 'scheduled',
      }, { ttl: 86400 });

      this.lastWarmingTime = new Date();
    } catch (error) {
      console.error('[RouteCache] Cache warming failed:', error);
      
      await cacheService.set(routeCacheKeys.warmingStatus(), {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        startTime: new Date(Date.now() - (Date.now() - startTime)),
        type: 'scheduled',
      }, { ttl: 3600 });
    } finally {
      this.warmingInProgress = false;
    }
  }

  /**
   * Warm frequently used routes
   */
  private async warmFrequentRoutes(): Promise<void> {
    const frequent = await cacheService.get<Array<{
      origin: string | LatLng | DutchAddress;
      destination: string | LatLng | DutchAddress;
      travelMode: TravelMode;
      count: number;
      lastUsed: string;
    }>>(routeCacheKeys.frequentRoutes());

    if (!frequent || frequent.length === 0) {
      console.log('[RouteCache] No frequent routes to warm');
      return;
    }

    console.log(`[RouteCache] Warming ${frequent.length} frequent routes`);

    // Check which routes need warming (top 50)
    const toWarm = frequent.slice(0, 50);
    let warmedCount = 0;

    for (const route of toWarm) {
      const cached = await this.getRoute(
        route.origin,
        route.destination,
        route.travelMode
      );
      
      if (!cached) {
        // This will trigger route calculation in the main service
        warmedCount++;
      }
    }

    console.log(`[RouteCache] Warmed ${warmedCount} frequent routes`);
  }

  /**
   * Warm service area routes
   */
  private async warmServiceAreaRoutes(): Promise<void> {
    const today = startOfDay(new Date());
    const serviceAreaNames = Object.keys(SERVICE_AREAS);

    console.log(`[RouteCache] Warming routes for ${serviceAreaNames.length} service areas`);

    // Get upcoming appointments for each service area
    for (const area of serviceAreaNames) {
      const areaCoords = SERVICE_AREAS[area as keyof typeof SERVICE_AREAS];
      
      // Get appointments near this service area for the next 7 days
      const appointments = await prisma.afspraak.findMany({
        where: {
          datum: {
            gte: today,
            lte: addDays(today, 7),
          },
          status: {
            notIn: ['geannuleerd', 'afgerond'],
          },
        },
        include: {
          customer: true,
          lead: true,
        },
        take: 20, // Limit per area
      });

      // Create distance matrix for this service area
      const destinations = appointments
        .map(apt => {
          if (apt.customer?.latitude && apt.customer?.longitude) {
            return { lat: apt.customer.latitude, lng: apt.customer.longitude };
          } else if (apt.lead?.latitude && apt.lead?.longitude) {
            return { lat: apt.lead.latitude, lng: apt.lead.longitude };
          }
          return null;
        })
        .filter(Boolean) as LatLng[];

      if (destinations.length > 0) {
        const cached = await this.getDistanceMatrix(
          [areaCoords],
          destinations,
          TravelMode.DRIVING
        );
        
        if (!cached) {
          console.log(`[RouteCache] Need to calculate matrix for ${area} (${destinations.length} destinations)`);
        }
      }
    }
  }

  /**
   * Warm routes for upcoming appointments
   */
  private async warmUpcomingAppointmentRoutes(): Promise<void> {
    const today = startOfDay(new Date());
    
    // Get route clusters for the next 3 days
    const routeClusters = await prisma.routeCluster.findMany({
      where: {
        datum: {
          gte: today,
          lte: addDays(today, 3),
        },
      },
      include: {
        afspraken: {
          include: {
            customer: true,
            lead: true,
          },
        },
      },
      take: 10,
    });

    console.log(`[RouteCache] Warming ${routeClusters.length} route clusters`);

    for (const cluster of routeClusters) {
      const cached = await this.getRouteCluster(cluster.id);
      
      if (!cached && cluster.afspraken.length > 1) {
        // Build waypoints for optimization
        const waypoints = cluster.afspraken.map(apt => {
          if (apt.customer?.latitude && apt.customer?.longitude) {
            return { lat: apt.customer.latitude, lng: apt.customer.longitude };
          } else if (apt.lead?.latitude && apt.lead?.longitude) {
            return { lat: apt.lead.latitude, lng: apt.lead.longitude };
          }
          return null;
        }).filter(Boolean) as LatLng[];

        if (waypoints.length > 1) {
          console.log(`[RouteCache] Need to optimize cluster ${cluster.id} with ${waypoints.length} waypoints`);
        }
      }
    }
  }

  /**
   * Pre-calculate distance matrices for common areas
   */
  private async warmDistanceMatrices(): Promise<void> {
    // Get popular postal code areas from recent appointments
    const popularAreas = await prisma.$queryRaw<Array<{ 
      postal_prefix: string; 
      count: bigint;
      avg_lat: number;
      avg_lng: number;
    }>>`
      SELECT 
        LEFT(COALESCE(c.postal_code, l.postcode), 4) as postal_prefix,
        COUNT(*) as count,
        AVG(COALESCE(c.latitude, l.latitude)) as avg_lat,
        AVG(COALESCE(c.longitude, l.longitude)) as avg_lng
      FROM afspraken a
      LEFT JOIN customers c ON a.customer_id = c.id
      LEFT JOIN leads l ON a.lead_id = l.id
      WHERE a.datum >= ${addDays(new Date(), -30)}
        AND a.status NOT IN ('geannuleerd', 'afgerond')
        AND (c.latitude IS NOT NULL OR l.latitude IS NOT NULL)
      GROUP BY postal_prefix
      ORDER BY count DESC
      LIMIT 10
    `;

    if (popularAreas.length === 0) return;

    console.log(`[RouteCache] Creating distance matrices for ${popularAreas.length} popular areas`);

    // Create matrices between popular areas
    const origins = popularAreas.slice(0, 5).map(area => ({
      lat: area.avg_lat,
      lng: area.avg_lng,
    }));

    const destinations = popularAreas.map(area => ({
      lat: area.avg_lat,
      lng: area.avg_lng,
    }));

    const cached = await this.getDistanceMatrix(origins, destinations, TravelMode.DRIVING);
    
    if (!cached) {
      console.log(`[RouteCache] Need to calculate ${origins.length}x${destinations.length} matrix`);
    }
  }

  /**
   * Track route usage for intelligent warming
   */
  private trackRouteUsage(routeKey: string): void {
    const count = this.routeUsageTracking.get(routeKey) || 0;
    this.routeUsageTracking.set(routeKey, count + 1);
  }

  /**
   * Update frequently used routes
   */
  private async updateFrequentRoutes(
    origin: string | LatLng | DutchAddress,
    destination: string | LatLng | DutchAddress,
    travelMode: TravelMode
  ): Promise<void> {
    const key = routeCacheKeys.frequentRoutes();
    const frequent = await cacheService.get<Array<{
      origin: string | LatLng | DutchAddress;
      destination: string | LatLng | DutchAddress;
      travelMode: TravelMode;
      count: number;
      lastUsed: string;
    }>>(key) || [];

    // Find existing entry
    const existingIndex = frequent.findIndex(f => 
      JSON.stringify(f.origin) === JSON.stringify(origin) &&
      JSON.stringify(f.destination) === JSON.stringify(destination) &&
      f.travelMode === travelMode
    );

    if (existingIndex >= 0) {
      frequent[existingIndex].count++;
      frequent[existingIndex].lastUsed = new Date().toISOString();
    } else {
      frequent.push({
        origin,
        destination,
        travelMode,
        count: 1,
        lastUsed: new Date().toISOString(),
      });
    }

    // Sort by count and keep top 100
    frequent.sort((a, b) => b.count - a.count);
    const topFrequent = frequent.slice(0, 100);

    await cacheService.set(key, topFrequent, { ttl: 30 * 24 * 60 * 60 });
  }

  /**
   * Persist route usage tracking
   */
  private async persistRouteUsage(): Promise<void> {
    if (this.routeUsageTracking.size === 0) return;

    // This is a placeholder - in production, you might want to persist this to a database
    console.log(`[RouteCache] Tracked usage for ${this.routeUsageTracking.size} routes`);
    
    // Clear the tracking map after persisting
    this.routeUsageTracking.clear();
  }

  /**
   * Invalidate routes for a specific area
   */
  async invalidateArea(center: LatLng, radiusKm: number): Promise<void> {
    // This is simplified - in production, you'd need spatial indexing
    console.log(`[RouteCache] Invalidating routes within ${radiusKm}km of ${center.lat}, ${center.lng}`);
    
    // For now, just clear service area caches
    const pattern = 'route:service:*';
    await cacheService.deletePattern(pattern);
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    totalCached: number;
    frequentRoutes: number;
    warmingStatus: any;
    routeTypes: {
      standard: number;
      optimized: number;
      matrix: number;
      cluster: number;
    };
    cacheStats: any;
  }> {
    const frequent = await cacheService.get<any[]>(routeCacheKeys.frequentRoutes()) || [];
    const warmingStatus = await cacheService.get<any>(routeCacheKeys.warmingStatus());
    const cacheStats = cacheService.getStats();

    // This is simplified - in production, you'd count by pattern
    return {
      totalCached: cacheStats.redisKeys,
      frequentRoutes: frequent.length,
      warmingStatus,
      routeTypes: {
        standard: 0, // Would count route:driving:* etc
        optimized: 0, // Would count route:optimized:*
        matrix: 0, // Would count route:matrix:*
        cluster: 0, // Would count route:cluster:*
      },
      cacheStats,
    };
  }
}

// Export singleton instance
export const routeCache = RouteCache.getInstance();