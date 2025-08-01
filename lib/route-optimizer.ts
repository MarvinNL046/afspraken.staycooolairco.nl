import { googleMaps } from './google-maps';
import { TravelMode, LatLng, RouteRequest, RouteResponse, UnitSystem, TrafficModel } from '../types/google-maps';
import { redis, ensureRedisConnection } from './redis';
import { differenceInMinutes, format } from 'date-fns';

interface RouteOptimizationRequest {
  origin: LatLng;
  waypoints: LatLng[];
  destination: LatLng;
  travelMode: TravelMode;
  departureTime?: Date;
  trafficModel?: TrafficModel;
}

interface OptimizedRoute {
  orderedWaypoints: LatLng[];
  totalDistance: number; // meters
  totalDuration: number; // minutes
  legs: RouteLeg[];
  efficiency: number;
  polyline?: string;
}

interface RouteLeg {
  from: LatLng;
  to: LatLng;
  distance: number; // meters
  duration: number; // minutes
  trafficDuration?: number; // minutes with traffic
}

export class RouteOptimizer {
  private static instance: RouteOptimizer;
  private performanceMetrics: Map<string, any> = new Map();

  private constructor() {}

  static getInstance(): RouteOptimizer {
    if (!RouteOptimizer.instance) {
      RouteOptimizer.instance = new RouteOptimizer();
    }
    return RouteOptimizer.instance;
  }

  /**
   * Optimize route with traffic-aware calculations
   */
  async optimizeRoute(request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    const startTime = Date.now();
    await ensureRedisConnection();

    // Generate cache key
    const cacheKey = this.generateCacheKey(request);
    
    // Check cache for recent optimization
    const cached = await this.getCachedRoute(cacheKey);
    if (cached) {
      this.recordMetric('cache_hit', true);
      return cached;
    }

    try {
      // Prepare Google Maps request
      const routeRequest: RouteRequest = {
        origin: request.origin,
        destination: request.destination,
        waypoints: request.waypoints,
        travelMode: request.travelMode,
        optimizeWaypoints: true,
        alternatives: false,
        language: 'nl',
        units: UnitSystem.METRIC,
        region: 'NL',
        departureTime: request.departureTime,
        trafficModel: request.trafficModel || TrafficModel.BEST_GUESS,
      };

      // Call Google Maps API with optimization
      const response = await googleMaps.optimizeRoute(
        request.origin,
        request.waypoints,
        request.destination,
        request.travelMode
      );
      
      // Process and optimize the response
      const optimized = this.processRouteResponse(response, request);
      
      // Cache the result
      await this.cacheRoute(cacheKey, optimized);
      
      // Record performance metrics
      this.recordMetric('optimization_time', Date.now() - startTime);
      this.recordMetric('cache_hit', false);
      
      return optimized;

    } catch (error) {
      console.error('Route optimization error:', error);
      // Fallback to simple optimization
      return this.fallbackOptimization(request);
    }
  }

  /**
   * Batch optimize multiple routes
   */
  async batchOptimizeRoutes(
    requests: RouteOptimizationRequest[]
  ): Promise<OptimizedRoute[]> {
    const results: OptimizedRoute[] = [];
    
    // Process in parallel batches to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(req => this.optimizeRoute(req))
      );
      results.push(...batchResults);
      
      // Small delay to avoid rate limits
      if (i + batchSize < requests.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }

  /**
   * Calculate time windows for appointments
   */
  calculateTimeWindows(
    appointments: Array<{ duration: number; travelTime: number }>,
    startTime: string,
    bufferMinutes: number = 15
  ): Array<{ start: string; end: string }> {
    const windows: Array<{ start: string; end: string }> = [];
    let currentTime = this.parseTime(startTime);

    for (const apt of appointments) {
      const start = this.formatTime(currentTime);
      currentTime += apt.duration;
      const end = this.formatTime(currentTime);
      
      windows.push({ start, end });
      
      // Add travel time and buffer
      currentTime += apt.travelTime + bufferMinutes;
    }

    return windows;
  }

  /**
   * Validate route constraints
   */
  validateRouteConstraints(
    route: OptimizedRoute,
    constraints: {
      maxDistance?: number; // meters
      maxDuration?: number; // minutes
      maxStops?: number;
      endTime?: string;
    }
  ): { valid: boolean; violations: string[] } {
    const violations: string[] = [];

    if (constraints.maxDistance && route.totalDistance > constraints.maxDistance) {
      violations.push(`Distance ${route.totalDistance}m exceeds limit ${constraints.maxDistance}m`);
    }

    if (constraints.maxDuration && route.totalDuration > constraints.maxDuration) {
      violations.push(`Duration ${route.totalDuration}min exceeds limit ${constraints.maxDuration}min`);
    }

    if (constraints.maxStops && route.orderedWaypoints.length > constraints.maxStops) {
      violations.push(`Stops ${route.orderedWaypoints.length} exceeds limit ${constraints.maxStops}`);
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Get route optimization suggestions
   */
  getOptimizationSuggestions(route: OptimizedRoute): string[] {
    const suggestions: string[] = [];

    // Check for excessive travel time
    const travelRatio = route.totalDuration / (route.orderedWaypoints.length * 60);
    if (travelRatio > 0.5) {
      suggestions.push('Consider grouping appointments by geographic area to reduce travel time');
    }

    // Check for traffic impact
    const hasTraffic = route.legs.some(leg => 
      leg.trafficDuration && leg.trafficDuration > leg.duration * 1.2
    );
    if (hasTraffic) {
      suggestions.push('Consider adjusting departure times to avoid traffic congestion');
    }

    // Check efficiency
    if (route.efficiency < 70) {
      suggestions.push('Route efficiency is low - consider reorganizing appointments');
    }

    return suggestions;
  }

  /**
   * Calculate route efficiency score
   */
  private calculateEfficiency(
    route: OptimizedRoute,
    originalDistance?: number
  ): number {
    // Base efficiency on optimization savings
    let efficiency = 100;

    if (originalDistance) {
      const savings = (originalDistance - route.totalDistance) / originalDistance;
      efficiency = Math.max(0, Math.min(100, savings * 100));
    }

    // Factor in time utilization
    const timeUtilization = route.orderedWaypoints.length * 60 / 
      (route.totalDuration + route.orderedWaypoints.length * 60);
    
    efficiency = (efficiency * 0.6 + timeUtilization * 100 * 0.4);

    return Math.round(efficiency);
  }

  private processRouteResponse(
    response: RouteResponse & { optimizedOrder: number[] },
    request: RouteOptimizationRequest
  ): OptimizedRoute {
    const route = response.routes[0];
    const orderedWaypoints = response.optimizedOrder.map(i => request.waypoints[i]);

    // Process legs
    const legs: RouteLeg[] = [];
    let totalDistance = 0;
    let totalDuration = 0;

    // Add origin to first waypoint
    if (route.legs.length > 0) {
      const firstLeg = route.legs[0];
      legs.push({
        from: request.origin,
        to: orderedWaypoints[0] || request.destination,
        distance: firstLeg.distance.value,
        duration: Math.round(firstLeg.duration.value / 60),
        trafficDuration: firstLeg.durationInTraffic ? 
          Math.round(firstLeg.durationInTraffic.value / 60) : undefined,
      });
      totalDistance += firstLeg.distance.value;
      totalDuration += firstLeg.duration.value / 60;
    }

    // Process waypoint legs
    for (let i = 1; i < route.legs.length - 1; i++) {
      const leg = route.legs[i];
      legs.push({
        from: orderedWaypoints[i - 1],
        to: orderedWaypoints[i],
        distance: leg.distance.value,
        duration: Math.round(leg.duration.value / 60),
        trafficDuration: leg.durationInTraffic ? 
          Math.round(leg.durationInTraffic.value / 60) : undefined,
      });
      totalDistance += leg.distance.value;
      totalDuration += leg.duration.value / 60;
    }

    // Add last waypoint to destination
    if (route.legs.length > 1) {
      const lastLeg = route.legs[route.legs.length - 1];
      legs.push({
        from: orderedWaypoints[orderedWaypoints.length - 1] || request.origin,
        to: request.destination,
        distance: lastLeg.distance.value,
        duration: Math.round(lastLeg.duration.value / 60),
        trafficDuration: lastLeg.durationInTraffic ? 
          Math.round(lastLeg.durationInTraffic.value / 60) : undefined,
      });
      totalDistance += lastLeg.distance.value;
      totalDuration += lastLeg.duration.value / 60;
    }

    // Calculate original distance for efficiency
    const originalDistance = this.calculateNaiveDistance(request);
    const efficiency = this.calculateEfficiency(
      { orderedWaypoints, totalDistance, totalDuration: Math.round(totalDuration), legs, efficiency: 0 },
      originalDistance
    );

    return {
      orderedWaypoints,
      totalDistance: Math.round(totalDistance),
      totalDuration: Math.round(totalDuration),
      legs,
      efficiency,
      polyline: route.overviewPolyline,
    };
  }

  private fallbackOptimization(request: RouteOptimizationRequest): OptimizedRoute {
    // Simple nearest neighbor algorithm
    const unvisited = [...request.waypoints];
    const ordered: LatLng[] = [];
    let current = request.origin;
    let totalDistance = 0;
    let totalDuration = 0;
    const legs: RouteLeg[] = [];

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let nearestDist = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const dist = this.haversineDistance(current, unvisited[i]);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }

      const nearest = unvisited.splice(nearestIdx, 1)[0];
      ordered.push(nearest);

      const distance = nearestDist * 1000; // Convert to meters
      const duration = this.estimateDuration(distance, request.travelMode);

      legs.push({
        from: current,
        to: nearest,
        distance,
        duration,
      });

      totalDistance += distance;
      totalDuration += duration;
      current = nearest;
    }

    // Add final leg to destination
    const finalDist = this.haversineDistance(current, request.destination) * 1000;
    const finalDuration = this.estimateDuration(finalDist, request.travelMode);

    legs.push({
      from: current,
      to: request.destination,
      distance: finalDist,
      duration: finalDuration,
    });

    totalDistance += finalDist;
    totalDuration += finalDuration;

    return {
      orderedWaypoints: ordered,
      totalDistance: Math.round(totalDistance),
      totalDuration: Math.round(totalDuration),
      legs,
      efficiency: 75, // Fallback efficiency
    };
  }

  private haversineDistance(point1: LatLng, point2: LatLng): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRadians(point2.lat - point1.lat);
    const dLng = this.toRadians(point2.lng - point1.lng);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(point1.lat)) * Math.cos(this.toRadians(point2.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private estimateDuration(distanceMeters: number, mode: TravelMode): number {
    const speeds: Record<TravelMode, number> = {
      [TravelMode.DRIVING]: 40,    // km/h in urban areas
      [TravelMode.BICYCLING]: 18,  // km/h average
      [TravelMode.WALKING]: 5,     // km/h walking
      [TravelMode.TRANSIT]: 30,    // km/h public transport
      [TravelMode.TWO_WHEELER]: 25, // km/h scooter/motorcycle
    };

    const speedKmh = speeds[mode] || speeds[TravelMode.DRIVING];
    return Math.round((distanceMeters / 1000) / speedKmh * 60);
  }

  private calculateNaiveDistance(request: RouteOptimizationRequest): number {
    let distance = 0;
    
    // Origin to all waypoints and back
    distance += this.haversineDistance(request.origin, request.waypoints[0] || request.destination) * 1000;
    
    for (let i = 0; i < request.waypoints.length - 1; i++) {
      distance += this.haversineDistance(request.waypoints[i], request.waypoints[i + 1]) * 1000;
    }
    
    if (request.waypoints.length > 0) {
      distance += this.haversineDistance(
        request.waypoints[request.waypoints.length - 1],
        request.destination
      ) * 1000;
    }
    
    return distance;
  }

  private generateCacheKey(request: RouteOptimizationRequest): string {
    const waypoints = request.waypoints
      .map(w => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`)
      .join('|');
    
    const departure = request.departureTime ? 
      format(request.departureTime, 'yyyyMMddHH') : 'none';
    
    return `route:${request.travelMode}:${departure}:${waypoints}`;
  }

  private async getCachedRoute(key: string): Promise<OptimizedRoute | null> {
    try {
      const cached = await redis.get<OptimizedRoute>(key);
      if (cached) {
        return cached;
      }
    } catch (error) {
      console.error('Cache retrieval error:', error);
    }
    return null;
  }

  private async cacheRoute(key: string, route: OptimizedRoute): Promise<void> {
    try {
      // Cache for 1 hour for routes with traffic, 6 hours without
      const ttl = route.legs.some(l => l.trafficDuration) ? 3600 : 21600;
      await redis.set(key, route, ttl);
    } catch (error) {
      console.error('Cache storage error:', error);
    }
  }

  private parseTime(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private formatTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  private recordMetric(key: string, value: any): void {
    this.performanceMetrics.set(key, value);
  }

  getPerformanceMetrics(): Map<string, any> {
    return new Map(this.performanceMetrics);
  }
}

// Export singleton instance
export const routeOptimizer = RouteOptimizer.getInstance();