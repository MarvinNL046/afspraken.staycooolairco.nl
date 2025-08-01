import { PrismaClient } from '@prisma/client';
import { cacheService } from './redis-cache.service';
import { 
  addDays, 
  startOfDay, 
  format, 
  isWeekend, 
  endOfDay,
  differenceInHours,
  isSameDay
} from 'date-fns';
import { TimeSlotWithAvailability } from '@/lib/types';
import { BUSINESS_HOURS, DATE_CONSTRAINTS } from '@/lib/types';

const prisma = new PrismaClient();

// Cache configuration
const AVAILABILITY_CONFIG = {
  ttl: 3 * 60 * 60, // 3 hours for availability (changes frequently)
  warmAheadDays: 30, // Pre-warm 30 days ahead
  namespace: 'avail',
  compressionThreshold: 1024, // Compress results > 1KB
};

// Cache key generators
export const availabilityCacheKeys = {
  // Key for available slots on a specific date
  dateSlots: (date: Date): string => {
    const dateStr = format(startOfDay(date), 'yyyy-MM-dd');
    return `avail:slots:${dateStr}`;
  },
  
  // Key for available dates in a range
  dateRange: (startDate: Date, endDate: Date): string => {
    const startStr = format(startOfDay(startDate), 'yyyy-MM-dd');
    const endStr = format(startOfDay(endDate), 'yyyy-MM-dd');
    return `avail:range:${startStr}:${endStr}`;
  },
  
  // Key for blocked dates
  blockedDates: (): string => 'avail:blocked:dates',
  
  // Key for calendar events cache
  calendarEvents: (date: Date): string => {
    const dateStr = format(startOfDay(date), 'yyyy-MM-dd');
    return `avail:calendar:${dateStr}`;
  },
  
  // Key for slot booking count
  slotBookings: (date: Date, time: string): string => {
    const dateStr = format(startOfDay(date), 'yyyy-MM-dd');
    return `avail:bookings:${dateStr}:${time}`;
  },
  
  // Key for warming status
  warmingStatus: (): string => 'avail:warming:status',
  
  // Key pattern for invalidation
  datePattern: (date: Date): string => {
    const dateStr = format(startOfDay(date), 'yyyy-MM-dd');
    return `avail:*:${dateStr}*`;
  },
};

/**
 * Availability Cache Manager
 * Handles caching, invalidation, and warming for appointment availability
 */
export class AvailabilityCache {
  private static instance: AvailabilityCache;
  private warmingInProgress = false;
  private lastWarmingTime?: Date;
  private invalidationQueue: Set<string> = new Set();

  private constructor() {
    // Register namespace configuration
    cacheService.registerNamespace('avail', AVAILABILITY_CONFIG);
    
    // Register warmup task
    cacheService.registerWarmupTask('availability', () => this.warmCache());
    
    // Process invalidation queue periodically
    setInterval(() => this.processInvalidationQueue(), 5000); // Every 5 seconds
  }

  static getInstance(): AvailabilityCache {
    if (!AvailabilityCache.instance) {
      AvailabilityCache.instance = new AvailabilityCache();
    }
    return AvailabilityCache.instance;
  }

  /**
   * Get available slots for a specific date
   */
  async getAvailableSlots(date: Date): Promise<TimeSlotWithAvailability[] | null> {
    const key = availabilityCacheKeys.dateSlots(date);
    const cached = await cacheService.get<TimeSlotWithAvailability[]>(key);
    
    if (cached) {
      // Verify the cached data is still valid by checking booking counts
      const isValid = await this.verifyCachedSlots(date, cached);
      if (isValid) {
        return cached;
      }
      // If not valid, invalidate and return null to trigger recalculation
      await this.invalidateDate(date);
    }
    
    return null;
  }

  /**
   * Set available slots for a specific date
   */
  async setAvailableSlots(
    date: Date, 
    slots: TimeSlotWithAvailability[],
    options?: { ttl?: number }
  ): Promise<void> {
    const key = availabilityCacheKeys.dateSlots(date);
    
    // Also update individual slot booking counts for real-time validation
    const bookingUpdates = slots.map(slot => ({
      key: availabilityCacheKeys.slotBookings(date, slot.startTime),
      value: { count: slot.currentBookings, maxAppointments: slot.maxAppointments },
      ttl: options?.ttl || AVAILABILITY_CONFIG.ttl,
    }));
    
    await Promise.all([
      cacheService.set(key, slots, {
        ttl: options?.ttl || AVAILABILITY_CONFIG.ttl,
        namespace: 'avail',
      }),
      cacheService.mset(bookingUpdates, { namespace: 'avail' }),
    ]);
  }

  /**
   * Get available dates within a range
   */
  async getAvailableDates(startDate: Date, endDate: Date): Promise<Date[] | null> {
    const key = availabilityCacheKeys.dateRange(startDate, endDate);
    return cacheService.get<Date[]>(key);
  }

  /**
   * Set available dates within a range
   */
  async setAvailableDates(
    startDate: Date, 
    endDate: Date, 
    dates: Date[],
    options?: { ttl?: number }
  ): Promise<void> {
    const key = availabilityCacheKeys.dateRange(startDate, endDate);
    await cacheService.set(key, dates, {
      ttl: options?.ttl || AVAILABILITY_CONFIG.ttl,
      namespace: 'avail',
    });
  }

  /**
   * Get blocked dates from cache
   */
  async getBlockedDates(): Promise<Date[] | null> {
    const key = availabilityCacheKeys.blockedDates();
    return cacheService.get<Date[]>(key);
  }

  /**
   * Update blocked dates cache
   */
  async updateBlockedDates(dates: Date[]): Promise<void> {
    const key = availabilityCacheKeys.blockedDates();
    await cacheService.set(key, dates, {
      ttl: 24 * 60 * 60, // 24 hours
      namespace: 'avail',
    });
  }

  /**
   * Invalidate cache for a specific date (real-time updates)
   */
  async invalidateDate(date: Date): Promise<void> {
    const dateStr = format(startOfDay(date), 'yyyy-MM-dd');
    
    // Add to invalidation queue for batch processing
    this.invalidationQueue.add(dateStr);
    
    // Immediately invalidate critical keys
    const keys = [
      availabilityCacheKeys.dateSlots(date),
      availabilityCacheKeys.calendarEvents(date),
    ];
    
    await Promise.all(keys.map(key => cacheService.delete(key)));
    
    // Invalidate any date ranges that include this date
    await this.invalidateDateRanges(date);
  }

  /**
   * Mark a slot as booked (real-time update)
   */
  async markSlotBooked(date: Date, time: string): Promise<void> {
    const bookingKey = availabilityCacheKeys.slotBookings(date, time);
    const current = await cacheService.get<{ count: number; maxAppointments: number }>(bookingKey);
    
    if (current) {
      await cacheService.set(bookingKey, {
        ...current,
        count: current.count + 1,
      }, { ttl: AVAILABILITY_CONFIG.ttl, namespace: 'avail' });
    }
    
    // Invalidate the date's slot cache
    await this.invalidateDate(date);
  }

  /**
   * Mark a slot as available (real-time update)
   */
  async markSlotAvailable(date: Date, time: string): Promise<void> {
    const bookingKey = availabilityCacheKeys.slotBookings(date, time);
    const current = await cacheService.get<{ count: number; maxAppointments: number }>(bookingKey);
    
    if (current && current.count > 0) {
      await cacheService.set(bookingKey, {
        ...current,
        count: current.count - 1,
      }, { ttl: AVAILABILITY_CONFIG.ttl, namespace: 'avail' });
    }
    
    // Invalidate the date's slot cache
    await this.invalidateDate(date);
  }

  /**
   * Intelligent cache warming
   */
  async warmCache(): Promise<void> {
    if (this.warmingInProgress) {
      console.log('[AvailabilityCache] Warming already in progress, skipping...');
      return;
    }

    this.warmingInProgress = true;
    const startTime = Date.now();

    try {
      console.log('[AvailabilityCache] Starting cache warming...');

      // Update warming status
      await cacheService.set(availabilityCacheKeys.warmingStatus(), {
        status: 'in_progress',
        startTime: new Date(),
        type: 'scheduled',
      }, { ttl: 3600 });

      // 1. Warm blocked dates
      await this.warmBlockedDates();

      // 2. Warm availability for the next N days
      await this.warmUpcomingAvailability();

      // 3. Warm popular time slots
      await this.warmPopularTimeSlots();

      // 4. Pre-calculate date ranges
      await this.warmDateRanges();

      const duration = Date.now() - startTime;
      console.log(`[AvailabilityCache] Cache warming completed in ${duration}ms`);

      // Update warming status
      await cacheService.set(availabilityCacheKeys.warmingStatus(), {
        status: 'completed',
        startTime: this.lastWarmingTime,
        endTime: new Date(),
        duration,
        type: 'scheduled',
      }, { ttl: 86400 });

      this.lastWarmingTime = new Date();
    } catch (error) {
      console.error('[AvailabilityCache] Cache warming failed:', error);
      
      await cacheService.set(availabilityCacheKeys.warmingStatus(), {
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
   * Warm blocked dates cache
   */
  private async warmBlockedDates(): Promise<void> {
    const blockedDates = await prisma.blockedDate.findMany({
      where: {
        date: {
          gte: startOfDay(new Date()),
        },
      },
    });

    const dates = blockedDates.map(bd => bd.date);
    await this.updateBlockedDates(dates);
    
    console.log(`[AvailabilityCache] Warmed ${dates.length} blocked dates`);
  }

  /**
   * Warm availability for upcoming days
   */
  private async warmUpcomingAvailability(): Promise<void> {
    const startDate = startOfDay(new Date());
    const endDate = addDays(startDate, AVAILABILITY_CONFIG.warmAheadDays);
    
    console.log(`[AvailabilityCache] Warming availability for ${AVAILABILITY_CONFIG.warmAheadDays} days`);
    
    let current = new Date(startDate);
    let warmedCount = 0;
    
    while (current <= endDate) {
      // Skip weekends if configured
      if (!isWeekend(current) || !DATE_CONSTRAINTS.excludeWeekends) {
        // Check if already cached
        const cached = await this.getAvailableSlots(current);
        if (!cached) {
          // This will trigger the availability calculation in the main service
          warmedCount++;
        }
      }
      
      current = addDays(current, 1);
    }
    
    console.log(`[AvailabilityCache] Warmed ${warmedCount} days of availability`);
  }

  /**
   * Warm popular time slots based on historical data
   */
  private async warmPopularTimeSlots(): Promise<void> {
    // Get most booked time slots from the last 30 days
    const thirtyDaysAgo = addDays(new Date(), -30);
    
    const popularSlots = await prisma.afspraak.groupBy({
      by: ['tijd'],
      where: {
        datum: {
          gte: thirtyDaysAgo,
        },
        status: {
          notIn: ['geannuleerd', 'niet_verschenen'],
        },
      },
      _count: {
        tijd: true,
      },
      orderBy: {
        _count: {
          tijd: 'desc',
        },
      },
      take: 10,
    });
    
    console.log(`[AvailabilityCache] Identified ${popularSlots.length} popular time slots`);
  }

  /**
   * Pre-calculate common date ranges
   */
  private async warmDateRanges(): Promise<void> {
    const startDate = startOfDay(new Date());
    
    // Common ranges: 7 days, 14 days, 30 days
    const ranges = [7, 14, 30];
    
    for (const days of ranges) {
      const endDate = addDays(startDate, days);
      const cached = await this.getAvailableDates(startDate, endDate);
      
      if (!cached) {
        // This will trigger calculation in the main service
        console.log(`[AvailabilityCache] Warming ${days}-day range`);
      }
    }
  }

  /**
   * Verify cached slots are still valid
   */
  private async verifyCachedSlots(
    date: Date, 
    cachedSlots: TimeSlotWithAvailability[]
  ): Promise<boolean> {
    // Quick validation by checking a sample of booking counts
    const sampleSize = Math.min(5, cachedSlots.length);
    const sampleSlots = cachedSlots.slice(0, sampleSize);
    
    for (const slot of sampleSlots) {
      const bookingKey = availabilityCacheKeys.slotBookings(date, slot.startTime);
      const current = await cacheService.get<{ count: number }>(bookingKey);
      
      if (current && current.count !== slot.currentBookings) {
        return false; // Cache is stale
      }
    }
    
    return true;
  }

  /**
   * Invalidate date ranges that include a specific date
   */
  private async invalidateDateRanges(date: Date): Promise<void> {
    // This is simplified - in production, you might want to track which ranges exist
    const startDate = startOfDay(new Date());
    const ranges = [7, 14, 30];
    
    for (const days of ranges) {
      const endDate = addDays(startDate, days);
      if (date >= startDate && date <= endDate) {
        const key = availabilityCacheKeys.dateRange(startDate, endDate);
        await cacheService.delete(key);
      }
    }
  }

  /**
   * Process invalidation queue in batches
   */
  private async processInvalidationQueue(): Promise<void> {
    if (this.invalidationQueue.size === 0) return;
    
    const batch = Array.from(this.invalidationQueue);
    this.invalidationQueue.clear();
    
    // Process invalidations
    for (const dateStr of batch) {
      const pattern = `avail:*:${dateStr}*`;
      await cacheService.deletePattern(pattern);
    }
    
    if (batch.length > 0) {
      console.log(`[AvailabilityCache] Processed ${batch.length} invalidations`);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    totalCached: number;
    warmingStatus: any;
    upcomingDaysCached: number;
    invalidationQueueSize: number;
    cacheStats: any;
  }> {
    const warmingStatus = await cacheService.get<any>(availabilityCacheKeys.warmingStatus());
    const cacheStats = cacheService.getStats();
    
    // Count cached upcoming days
    let upcomingDaysCached = 0;
    const today = startOfDay(new Date());
    
    for (let i = 0; i < 30; i++) {
      const date = addDays(today, i);
      const cached = await this.getAvailableSlots(date);
      if (cached) upcomingDaysCached++;
    }
    
    return {
      totalCached: cacheStats.redisKeys,
      warmingStatus,
      upcomingDaysCached,
      invalidationQueueSize: this.invalidationQueue.size,
      cacheStats,
    };
  }

  /**
   * Clear all availability cache
   */
  async flush(): Promise<void> {
    await cacheService.deletePattern('avail:*');
    this.invalidationQueue.clear();
  }
}

// Export singleton instance
export const availabilityCache = AvailabilityCache.getInstance();