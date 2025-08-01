import { Client } from '@googlemaps/google-maps-services-js';
import { 
  DutchAddress, 
  GeocodingResult, 
  LatLng, 
  RouteRequest, 
  RouteResponse,
  TravelMode,
  UnitSystem,
  TrafficModel,
  GoogleMapsError,
  RateLimitError,
  QuotaExceededError,
  PerformanceMetrics,
  FIELD_MASKS,
  DUTCH_REGIONS
} from '@/types/google-maps';
import { redis, cacheKeys, cacheTTL } from './redis';

// Performance monitoring
const performanceMetrics: PerformanceMetrics[] = [];

class GoogleMapsService {
  private static instance: GoogleMapsService;
  private client: Client;
  private apiKey: string;
  private requestCount = 0;
  private dailyQuota = 10000; // Adjust based on your plan
  private costTracking = {
    geocoding: 0,
    routes: 0,
    matrix: 0,
  };

  private constructor() {
    this.client = new Client({});
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    
    if (!this.apiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY is not configured');
    }

    // Initialize Redis connection
    redis.connect().catch(console.error);
  }

  static getInstance(): GoogleMapsService {
    if (!GoogleMapsService.instance) {
      GoogleMapsService.instance = new GoogleMapsService();
    }
    return GoogleMapsService.instance;
  }

  // Performance tracking wrapper
  private async trackPerformance<T>(
    apiType: 'geocoding' | 'routes' | 'matrix',
    operation: () => Promise<T>,
    cached: boolean = false
  ): Promise<T> {
    const startTime = Date.now();
    let error: string | undefined;

    try {
      const result = await operation();
      return result;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
      throw e;
    } finally {
      const latency = Date.now() - startTime;
      const metric: PerformanceMetrics = {
        apiType,
        latency,
        cached,
        cacheHit: cached,
        apiCost: cached ? 0 : this.estimateCost(apiType),
        timestamp: new Date(),
        error,
      };
      
      performanceMetrics.push(metric);
      
      // Keep only last 1000 metrics
      if (performanceMetrics.length > 1000) {
        performanceMetrics.shift();
      }
    }
  }

  // Estimate API cost in cents
  private estimateCost(apiType: 'geocoding' | 'routes' | 'matrix'): number {
    const costs = {
      geocoding: 0.5, // $5 per 1000
      routes: 1.0,    // $10 per 1000
      matrix: 1.0,    // $10 per 1000
    };
    return costs[apiType];
  }

  // Format Dutch address for optimal geocoding
  private formatDutchAddress(address: DutchAddress): string {
    const parts = [
      `${address.street} ${address.houseNumber}${address.houseNumberExt || ''}`,
      address.postalCode.replace(/\s/g, ' ').toUpperCase(),
      address.city,
      address.country || 'Netherlands'
    ];
    
    return parts.filter(Boolean).join(', ');
  }

  // Get region from Dutch postal code
  private getRegionFromPostalCode(postalCode: string): string {
    const prefix = postalCode.substring(0, 2);
    const region = DUTCH_REGIONS.find(r => r.code === prefix);
    return region?.region || 'Unknown';
  }

  // Geocode Dutch address with caching
  async geocodeAddress(address: DutchAddress): Promise<GeocodingResult> {
    const formattedAddress = this.formatDutchAddress(address);
    const cacheKey = cacheKeys.geocoding(formattedAddress);

    // Check cache first
    const cached = await redis.get<GeocodingResult>(cacheKey);
    if (cached) {
      return this.trackPerformance('geocoding', async () => cached, true);
    }

    // Check database for existing place ID
    // This would be implemented in the calling function

    return this.trackPerformance('geocoding', async () => {
      try {
        const response = await this.client.geocode({
          params: {
            address: formattedAddress,
            components: {
              country: 'NL',
              postal_code: address.postalCode,
            },
            language: 'nl',
            region: 'nl',
            key: this.apiKey,
          },
          timeout: 3000,
        });

        if (response.data.status !== 'OK' || !response.data.results.length) {
          throw new GoogleMapsError(
            `Geocoding failed: ${response.data.status}`,
            'GEOCODING_FAILED',
            response.status
          );
        }

        const result = response.data.results[0];
        const geocoded: GeocodingResult = {
          latitude: result.geometry.location.lat,
          longitude: result.geometry.location.lng,
          placeId: result.place_id,
          formattedAddress: result.formatted_address,
          accuracy: result.geometry.location_type as any,
          locationType: result.geometry.location_type as any,
          viewport: result.geometry.viewport,
        };

        // Cache the result
        await redis.set(cacheKey, geocoded, cacheTTL.geocoding);
        
        // Also cache by place ID for permanent storage
        await redis.set(cacheKeys.placeId(result.place_id), geocoded, cacheTTL.placeId);

        this.requestCount++;
        this.costTracking.geocoding++;

        return geocoded;
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('rate limit')) {
            throw new RateLimitError(60);
          }
          if (error.message.includes('quota')) {
            throw new QuotaExceededError();
          }
        }
        throw error;
      }
    });
  }

  // Batch geocode multiple addresses
  async batchGeocodeAddresses(addresses: DutchAddress[]): Promise<GeocodingResult[]> {
    // Check cache first
    const cachePromises = addresses.map(addr => {
      const key = cacheKeys.geocoding(this.formatDutchAddress(addr));
      return redis.get<GeocodingResult>(key);
    });

    const cachedResults = await Promise.all(cachePromises);
    const results: GeocodingResult[] = [];
    const toGeocode: { address: DutchAddress; index: number }[] = [];

    // Identify which addresses need geocoding
    cachedResults.forEach((cached, index) => {
      if (cached) {
        results[index] = cached;
      } else {
        toGeocode.push({ address: addresses[index], index });
      }
    });

    // Geocode missing addresses with rate limiting
    const geocodePromises = toGeocode.map(({ address, index }, i) => 
      new Promise<{ result: GeocodingResult; index: number }>(async (resolve, reject) => {
        // Add delay to respect rate limits (50 requests per second)
        await new Promise(r => setTimeout(r, i * 20));
        
        try {
          const result = await this.geocodeAddress(address);
          resolve({ result, index });
        } catch (error) {
          reject(error);
        }
      })
    );

    const geocodedResults = await Promise.allSettled(geocodePromises);
    
    geocodedResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        results[result.value.index] = result.value.result;
      }
    });

    return results;
  }

  // Calculate route using Routes API with optimization
  async calculateRoute(request: RouteRequest): Promise<RouteResponse> {
    const cacheKey = cacheKeys.routes(
      JSON.stringify(request.origin),
      JSON.stringify(request.destination),
      request.travelMode
    );

    // Check cache for recent routes
    const cached = await redis.get<RouteResponse>(cacheKey);
    if (cached) {
      return this.trackPerformance('routes', async () => cached, true);
    }

    return this.trackPerformance('routes', async () => {
      try {
        // Convert to Routes API format
        const formatRouteLocation = (loc: LatLng | string | DutchAddress) => {
          if (typeof loc === 'string') {
            return { address: loc };
          } else if ('lat' in loc && 'lng' in loc) {
            return { location: { latLng: loc } };
          } else {
            // It's a DutchAddress
            return { address: this.formatDutchAddress(loc) };
          }
        };
        
        const routesRequest = {
          origin: formatRouteLocation(request.origin),
          destination: formatRouteLocation(request.destination),
          travelMode: request.travelMode,
          routingPreference: 'TRAFFIC_AWARE',
          computeAlternativeRoutes: request.alternatives || false,
          routeModifiers: {
            avoidTolls: request.avoidTolls || false,
            avoidHighways: request.avoidHighways || false,
            avoidFerries: request.avoidFerries || false,
          },
          languageCode: 'nl-NL',
          units: 'METRIC',
        };

        // Add waypoints if provided
        if (request.waypoints && request.waypoints.length > 0) {
          (routesRequest as any).intermediates = request.waypoints.map(formatRouteLocation);
        }

        // Call Routes API
        const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': request.alternatives ? FIELD_MASKS.ADVANCED : FIELD_MASKS.BASIC,
          },
          body: JSON.stringify(routesRequest),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new GoogleMapsError(
            `Routes API error: ${error.error?.message || response.statusText}`,
            'ROUTES_API_ERROR',
            response.status,
            error
          );
        }

        const data = await response.json();
        
        // Transform to our format
        const routeResponse: RouteResponse = {
          routes: data.routes || [],
          geocodedWaypoints: data.geocodedWaypoints,
        };

        // Cache the result with shorter TTL for traffic-aware routes
        await redis.set(cacheKey, routeResponse, cacheTTL.routes);

        this.requestCount++;
        this.costTracking.routes++;

        return routeResponse;
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('rate limit')) {
            throw new RateLimitError(60);
          }
          if (error.message.includes('quota')) {
            throw new QuotaExceededError();
          }
        }
        throw error;
      }
    });
  }

  // Calculate distance matrix with batch optimization
  async calculateDistanceMatrix(
    origins: (LatLng | string | DutchAddress)[],
    destinations: (LatLng | string | DutchAddress)[],
    travelMode: TravelMode = TravelMode.DRIVING
  ): Promise<any> {
    const cacheKey = cacheKeys.matrix(
      origins.map(o => JSON.stringify(o)),
      destinations.map(d => JSON.stringify(d)),
      travelMode
    );

    // Check cache
    const cached = await redis.get<any>(cacheKey);
    if (cached) {
      return this.trackPerformance('matrix', async () => cached, true);
    }

    return this.trackPerformance('matrix', async () => {
      // Routes API supports matrix calculations through multiple requests
      // For now, we'll calculate individual routes
      const results = await Promise.all(
        origins.flatMap((origin, oi) =>
          destinations.map((destination, di) =>
            this.calculateRoute({
              origin,
              destination,
              travelMode,
              optimizeWaypoints: false,
              alternatives: false,
            }).then(route => ({
              originIndex: oi,
              destinationIndex: di,
              distance: route.routes[0]?.distanceMeters || 0,
              duration: parseInt(route.routes[0]?.duration?.replace('s', '') || '0'),
            }))
          )
        )
      );

      // Format as matrix
      const formatLocation = (loc: LatLng | string | DutchAddress): string => {
        if (typeof loc === 'string') return loc;
        if ('lat' in loc && 'lng' in loc) return `${loc.lat},${loc.lng}`;
        // It's a DutchAddress
        return this.formatDutchAddress(loc);
      };
      
      const matrix = {
        origins: origins.map(formatLocation),
        destinations: destinations.map(formatLocation),
        rows: origins.map((_, oi) => ({
          elements: destinations.map((_, di) => {
            const result = results.find(r => r.originIndex === oi && r.destinationIndex === di);
            return {
              distance: { value: result?.distance || 0, text: `${(result?.distance || 0) / 1000} km` },
              duration: { value: result?.duration || 0, text: `${Math.round((result?.duration || 0) / 60)} mins` },
              status: result ? 'OK' : 'NOT_FOUND',
            };
          }),
        })),
      };

      // Cache the result
      await redis.set(cacheKey, matrix, cacheTTL.matrix);

      this.costTracking.matrix++;

      return matrix;
    });
  }

  // Optimize route with multiple waypoints
  async optimizeRoute(
    origin: LatLng | string | DutchAddress,
    waypoints: (LatLng | string | DutchAddress)[],
    destination: LatLng | string | DutchAddress,
    travelMode: TravelMode = TravelMode.DRIVING
  ): Promise<RouteResponse & { optimizedOrder: number[] }> {
    if (waypoints.length > 25) {
      throw new GoogleMapsError(
        'Maximum 25 waypoints allowed for optimization',
        'TOO_MANY_WAYPOINTS',
        400
      );
    }

    const request: RouteRequest = {
      origin,
      destination,
      waypoints,
      travelMode,
      optimizeWaypoints: true,
      alternatives: false,
      language: 'nl',
      units: UnitSystem.METRIC,
      region: 'NL',
    };

    const response = await this.calculateRoute(request);
    
    // Extract optimized order
    const optimizedOrder = response.routes[0]?.waypointOrder || 
      waypoints.map((_, i) => i);

    return {
      ...response,
      optimizedOrder,
    };
  }

  // Get performance metrics
  getPerformanceMetrics(): {
    summary: {
      totalRequests: number;
      cacheHitRate: number;
      averageLatency: { [key: string]: number };
      totalCost: number;
    };
    recent: PerformanceMetrics[];
  } {
    const total = performanceMetrics.length;
    const cached = performanceMetrics.filter(m => m.cached).length;
    const byType = {
      geocoding: performanceMetrics.filter(m => m.apiType === 'geocoding'),
      routes: performanceMetrics.filter(m => m.apiType === 'routes'),
      matrix: performanceMetrics.filter(m => m.apiType === 'matrix'),
    };

    return {
      summary: {
        totalRequests: this.requestCount,
        cacheHitRate: total > 0 ? (cached / total) * 100 : 0,
        averageLatency: {
          geocoding: byType.geocoding.length > 0 
            ? byType.geocoding.reduce((sum, m) => sum + m.latency, 0) / byType.geocoding.length 
            : 0,
          routes: byType.routes.length > 0
            ? byType.routes.reduce((sum, m) => sum + m.latency, 0) / byType.routes.length
            : 0,
          matrix: byType.matrix.length > 0
            ? byType.matrix.reduce((sum, m) => sum + m.latency, 0) / byType.matrix.length
            : 0,
        },
        totalCost: (this.costTracking.geocoding * 0.5 + 
                   this.costTracking.routes * 1.0 + 
                   this.costTracking.matrix * 1.0) / 100, // Convert cents to dollars
      },
      recent: performanceMetrics.slice(-100),
    };
  }

  // Clear cache
  async clearCache(type?: 'geocoding' | 'routes' | 'matrix'): Promise<void> {
    if (!type) {
      await redis.flush();
    } else {
      // Clear specific cache type
      const pattern = `${type}:*`;
      // This would require implementing pattern-based deletion in Redis
      console.log(`Clearing cache for pattern: ${pattern}`);
    }
  }
}

// Export singleton instance
export const googleMaps = GoogleMapsService.getInstance();

// Helper function to convert address to LatLng
export async function addressToLatLng(address: DutchAddress): Promise<LatLng> {
  const result = await googleMaps.geocodeAddress(address);
  return {
    lat: result.latitude,
    lng: result.longitude,
  };
}

// Helper function to calculate driving time between two points
export async function calculateDrivingTime(
  origin: LatLng | DutchAddress,
  destination: LatLng | DutchAddress
): Promise<number> {
  // Convert addresses to LatLng if needed
  const originLatLng = 'lat' in origin ? origin : await addressToLatLng(origin);
  const destLatLng = 'lat' in destination ? destination : await addressToLatLng(destination);

  const route = await googleMaps.calculateRoute({
    origin: originLatLng,
    destination: destLatLng,
    travelMode: TravelMode.DRIVING,
    optimizeWaypoints: false,
    alternatives: false,
  });

  if (!route.routes.length) {
    throw new GoogleMapsError('No route found', 'NO_ROUTE', 404);
  }

  // Parse duration from "1234s" format
  const duration = route.routes[0].duration;
  return parseInt(duration.replace('s', ''));
}