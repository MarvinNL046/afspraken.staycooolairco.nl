import { PrismaClient } from '@prisma/client';
import { cacheService } from './redis-cache.service';
import { DutchAddress, GeocodingResult } from '@/types/google-maps';
import { addDays, startOfDay } from 'date-fns';

const prisma = new PrismaClient();

// Cache configuration
const GEOCODING_CONFIG = {
  ttl: 30 * 24 * 60 * 60, // 30 days for geocoding results
  namespace: 'geo',
  compressionThreshold: 512, // Compress results > 512 bytes
};

// Cache key generators
export const geocodingCacheKeys = {
  // Primary key for address lookup
  address: (address: DutchAddress | string): string => {
    if (typeof address === 'string') {
      return `geo:addr:${address.toLowerCase().replace(/[\s,]+/g, ':')}`;
    }
    const parts = [
      address.street,
      address.houseNumber,
      address.houseNumberExt || '',
      address.postalCode.replace(/\s/g, ''),
      address.city,
    ].filter(Boolean);
    return `geo:addr:${parts.join(':').toLowerCase()}`;
  },
  
  // Key for place ID lookup
  placeId: (placeId: string): string => `geo:place:${placeId}`,
  
  // Key for postal code area
  postalCode: (postalCode: string): string => 
    `geo:postal:${postalCode.replace(/\s/g, '').toUpperCase()}`,
  
  // Key for city
  city: (city: string): string => `geo:city:${city.toLowerCase()}`,
  
  // Key for frequently used addresses
  frequent: (): string => 'geo:frequent:addresses',
  
  // Key for warming status
  warmingStatus: (): string => 'geo:warming:status',
};

/**
 * Geocoding Cache Manager
 * Handles caching, warming, and optimization for geocoding results
 */
export class GeocodingCache {
  private static instance: GeocodingCache;
  private warmingInProgress = false;
  private lastWarmingTime?: Date;

  private constructor() {
    // Register namespace configuration
    cacheService.registerNamespace('geo', GEOCODING_CONFIG);
    
    // Register warmup task
    cacheService.registerWarmupTask('geocoding', () => this.warmCache());
  }

  static getInstance(): GeocodingCache {
    if (!GeocodingCache.instance) {
      GeocodingCache.instance = new GeocodingCache();
    }
    return GeocodingCache.instance;
  }

  /**
   * Get geocoding result from cache
   */
  async get(address: DutchAddress | string): Promise<GeocodingResult | null> {
    const key = geocodingCacheKeys.address(address);
    return cacheService.get<GeocodingResult>(key);
  }

  /**
   * Set geocoding result in cache
   */
  async set(
    address: DutchAddress | string, 
    result: GeocodingResult,
    options?: { ttl?: number }
  ): Promise<void> {
    const key = geocodingCacheKeys.address(address);
    await cacheService.set(key, result, {
      ttl: options?.ttl || GEOCODING_CONFIG.ttl,
      namespace: 'geo',
    });

    // Also cache by place ID for permanent lookup
    if (result.placeId) {
      await cacheService.set(
        geocodingCacheKeys.placeId(result.placeId),
        result,
        { ttl: 365 * 24 * 60 * 60 } // 1 year for place IDs
      );
    }

    // Update frequently used addresses
    await this.updateFrequentAddresses(address, result);
  }

  /**
   * Get geocoding result by place ID
   */
  async getByPlaceId(placeId: string): Promise<GeocodingResult | null> {
    const key = geocodingCacheKeys.placeId(placeId);
    return cacheService.get<GeocodingResult>(key);
  }

  /**
   * Batch get geocoding results
   */
  async batchGet(addresses: (DutchAddress | string)[]): Promise<(GeocodingResult | null)[]> {
    const keys = addresses.map(addr => geocodingCacheKeys.address(addr));
    return cacheService.mget<GeocodingResult>(keys);
  }

  /**
   * Batch set geocoding results
   */
  async batchSet(
    entries: Array<{ address: DutchAddress | string; result: GeocodingResult }>
  ): Promise<void> {
    const cacheEntries = entries.map(({ address, result }) => ({
      key: geocodingCacheKeys.address(address),
      value: result,
      ttl: GEOCODING_CONFIG.ttl,
    }));

    await cacheService.mset(cacheEntries, { namespace: 'geo' });

    // Also cache by place IDs
    const placeIdEntries = entries
      .filter(e => e.result.placeId)
      .map(({ result }) => ({
        key: geocodingCacheKeys.placeId(result.placeId!),
        value: result,
        ttl: 365 * 24 * 60 * 60, // 1 year
      }));

    if (placeIdEntries.length > 0) {
      await cacheService.mset(placeIdEntries, { namespace: 'geo' });
    }
  }

  /**
   * Intelligent cache warming
   */
  async warmCache(): Promise<void> {
    if (this.warmingInProgress) {
      console.log('[GeocodingCache] Warming already in progress, skipping...');
      return;
    }

    this.warmingInProgress = true;
    const startTime = Date.now();

    try {
      console.log('[GeocodingCache] Starting cache warming...');

      // Update warming status
      await cacheService.set(geocodingCacheKeys.warmingStatus(), {
        status: 'in_progress',
        startTime: new Date(),
        type: 'scheduled',
      }, { ttl: 3600 });

      // 1. Warm addresses from upcoming appointments (next 7 days)
      await this.warmUpcomingAppointments();

      // 2. Warm frequently used addresses
      await this.warmFrequentAddresses();

      // 3. Warm addresses from recent leads
      await this.warmRecentLeads();

      // 4. Warm postal code centroids for quick lookups
      await this.warmPostalCodeCentroids();

      const duration = Date.now() - startTime;
      console.log(`[GeocodingCache] Cache warming completed in ${duration}ms`);

      // Update warming status
      await cacheService.set(geocodingCacheKeys.warmingStatus(), {
        status: 'completed',
        startTime: this.lastWarmingTime,
        endTime: new Date(),
        duration,
        type: 'scheduled',
      }, { ttl: 86400 });

      this.lastWarmingTime = new Date();
    } catch (error) {
      console.error('[GeocodingCache] Cache warming failed:', error);
      
      await cacheService.set(geocodingCacheKeys.warmingStatus(), {
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
   * Warm cache for upcoming appointments
   */
  private async warmUpcomingAppointments(): Promise<void> {
    const startDate = startOfDay(new Date());
    const endDate = addDays(startDate, 7);

    const appointments = await prisma.afspraak.findMany({
      where: {
        datum: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          notIn: ['geannuleerd', 'afgerond'],
        },
      },
      include: {
        customer: true,
        lead: true,
      },
      take: 1000, // Limit to prevent overwhelming
    });

    console.log(`[GeocodingCache] Warming ${appointments.length} appointment addresses`);

    // Extract unique addresses
    const addressMap = new Map<string, DutchAddress>();

    for (const apt of appointments) {
      if (apt.customer && apt.customer.postalCode) {
        const address: DutchAddress = {
          street: apt.customer.address.split(' ').slice(0, -1).join(' '),
          houseNumber: apt.customer.address.split(' ').pop() || '',
          postalCode: apt.customer.postalCode,
          city: apt.customer.city,
        };
        const key = geocodingCacheKeys.address(address);
        addressMap.set(key, address);
      } else if (apt.lead && apt.lead.postcode) {
        const address: DutchAddress = {
          street: apt.lead.adres?.split(' ').slice(0, -1).join(' ') || '',
          houseNumber: apt.lead.adres?.split(' ').pop() || '',
          postalCode: apt.lead.postcode,
          city: apt.lead.stad || '',
        };
        const key = geocodingCacheKeys.address(address);
        addressMap.set(key, address);
      }
    }

    // Check which addresses are not cached
    const addresses = Array.from(addressMap.values());
    const cached = await this.batchGet(addresses);
    const toWarm = addresses.filter((_, i) => !cached[i]);

    if (toWarm.length > 0) {
      console.log(`[GeocodingCache] Need to geocode ${toWarm.length} addresses`);
      // In production, this would call the Google Maps service
      // For now, we'll just log it
    }
  }

  /**
   * Warm frequently used addresses
   */
  private async warmFrequentAddresses(): Promise<void> {
    const frequent = await cacheService.get<Array<{
      address: DutchAddress;
      count: number;
      lastUsed: string;
    }>>(geocodingCacheKeys.frequent());

    if (!frequent || frequent.length === 0) return;

    console.log(`[GeocodingCache] Warming ${frequent.length} frequent addresses`);

    // Check which ones need warming
    const addresses = frequent.map(f => f.address);
    const cached = await this.batchGet(addresses);
    const toWarm = addresses.filter((_, i) => !cached[i]);

    if (toWarm.length > 0) {
      console.log(`[GeocodingCache] Need to refresh ${toWarm.length} frequent addresses`);
    }
  }

  /**
   * Warm addresses from recent leads
   */
  private async warmRecentLeads(): Promise<void> {
    const recentLeads = await prisma.lead.findMany({
      where: {
        createdAt: {
          gte: addDays(new Date(), -7),
        },
        postcode: {
          not: '',
        },
        latitude: null, // Not yet geocoded
      },
      select: {
        id: true,
        adres: true,
        postcode: true,
        stad: true,
      },
      take: 500,
    });

    if (recentLeads.length > 0) {
      console.log(`[GeocodingCache] Found ${recentLeads.length} leads needing geocoding`);
    }
  }

  /**
   * Warm postal code centroids for area lookups
   */
  private async warmPostalCodeCentroids(): Promise<void> {
    // Get unique postal codes from recent activity
    const postalCodes = await prisma.$queryRaw<Array<{ postcode: string }>>`
      SELECT DISTINCT postcode 
      FROM (
        SELECT postcode FROM leads 
        WHERE postcode IS NOT NULL 
        AND created_at > ${addDays(new Date(), -30)}
        UNION
        SELECT postal_code as postcode FROM customers 
        WHERE postal_code IS NOT NULL
        AND created_at > ${addDays(new Date(), -30)}
      ) AS combined
      LIMIT 100
    `;

    console.log(`[GeocodingCache] Warming ${postalCodes.length} postal code areas`);

    // Check cache for each postal code area
    const keys = postalCodes.map(p => geocodingCacheKeys.postalCode(p.postcode));
    const cached = await cacheService.mget<any>(keys);
    const toWarm = postalCodes.filter((_, i) => !cached[i]);

    if (toWarm.length > 0) {
      console.log(`[GeocodingCache] Need to geocode ${toWarm.length} postal code areas`);
    }
  }

  /**
   * Update frequently used addresses tracking
   */
  private async updateFrequentAddresses(
    address: DutchAddress | string,
    result: GeocodingResult
  ): Promise<void> {
    const key = geocodingCacheKeys.frequent();
    const frequent = await cacheService.get<Array<{
      address: DutchAddress;
      result: GeocodingResult;
      count: number;
      lastUsed: string;
    }>>(key) || [];

    // Convert string address to DutchAddress if needed
    const dutchAddress: DutchAddress = typeof address === 'string' ? {
      street: address.split(',')[0].trim(),
      houseNumber: '',
      postalCode: '',
      city: address.split(',').pop()?.trim() || '',
    } : address;

    // Find existing entry
    const existingIndex = frequent.findIndex(f => 
      geocodingCacheKeys.address(f.address) === geocodingCacheKeys.address(address)
    );

    if (existingIndex >= 0) {
      frequent[existingIndex].count++;
      frequent[existingIndex].lastUsed = new Date().toISOString();
      frequent[existingIndex].result = result;
    } else {
      frequent.push({
        address: dutchAddress,
        result,
        count: 1,
        lastUsed: new Date().toISOString(),
      });
    }

    // Sort by count and keep top 1000
    frequent.sort((a, b) => b.count - a.count);
    const topFrequent = frequent.slice(0, 1000);

    await cacheService.set(key, topFrequent, { ttl: 30 * 24 * 60 * 60 });
  }

  /**
   * Invalidate cache for an address
   */
  async invalidate(address: DutchAddress | string): Promise<void> {
    const key = geocodingCacheKeys.address(address);
    await cacheService.delete(key);
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    totalCached: number;
    frequentAddresses: number;
    warmingStatus: any;
    cacheStats: any;
  }> {
    const frequent = await cacheService.get<any[]>(geocodingCacheKeys.frequent()) || [];
    const warmingStatus = await cacheService.get<any>(geocodingCacheKeys.warmingStatus());
    const cacheStats = cacheService.getStats();

    return {
      totalCached: cacheStats.redisKeys,
      frequentAddresses: frequent.length,
      warmingStatus,
      cacheStats,
    };
  }
}

// Export singleton instance
export const geocodingCache = GeocodingCache.getInstance();