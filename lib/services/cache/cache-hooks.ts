import { cacheManager } from './cache-manager';
import { PrismaClient } from '@prisma/client';
import { DutchAddress } from '@/types/google-maps';
import { addDays, startOfDay } from 'date-fns';

const prisma = new PrismaClient();

/**
 * Cache invalidation hooks for automatic cache updates
 * These hooks should be called when data changes to ensure cache consistency
 */

export class CacheHooks {
  /**
   * Hook: When an appointment is created
   */
  static async onAppointmentCreated(appointmentId: string): Promise<void> {
    try {
      const appointment = await prisma.afspraak.findUnique({
        where: { id: appointmentId },
        include: { customer: true, lead: true },
      });

      if (!appointment) return;

      // Invalidate availability for the appointment date
      await cacheManager.invalidateAvailability(appointment.datum);

      // If the appointment has a location, pre-warm geocoding
      if (appointment.locatie || appointment.customer || appointment.lead) {
        const address = this.extractAddress(appointment);
        if (address) {
          // Pre-warm geocoding for this address
          const { geocodingCache } = await import('./geocoding-cache');
          const result = await geocodingCache.get(address);
          if (!result) {
            // Trigger geocoding in background
            console.log(`[CacheHooks] Need to geocode new appointment address: ${appointmentId}`);
          }
        }
      }

      // Update route cache warming priority
      await this.updateRouteWarmingPriority(appointment.datum);
      
      console.log(`[CacheHooks] Processed appointment creation: ${appointmentId}`);
    } catch (error) {
      console.error('[CacheHooks] Error processing appointment creation:', error);
    }
  }

  /**
   * Hook: When an appointment is updated
   */
  static async onAppointmentUpdated(
    appointmentId: string,
    oldData: any,
    newData: any
  ): Promise<void> {
    try {
      // Check if date changed
      if (oldData.datum !== newData.datum) {
        // Invalidate both old and new dates
        await cacheManager.invalidateAvailability(oldData.datum);
        await cacheManager.invalidateAvailability(newData.datum);
      }

      // Check if time changed
      if (oldData.tijd !== newData.tijd && oldData.datum === newData.datum) {
        await cacheManager.markSlotAvailable(oldData.datum, oldData.tijd);
        await cacheManager.markSlotBooked(newData.datum, newData.tijd);
      }

      // Check if location changed
      if (oldData.locatie !== newData.locatie || 
          oldData.customerId !== newData.customerId ||
          oldData.leadId !== newData.leadId) {
        // Invalidate route caches for this date
        await this.invalidateRoutesForDate(newData.datum);
      }

      console.log(`[CacheHooks] Processed appointment update: ${appointmentId}`);
    } catch (error) {
      console.error('[CacheHooks] Error processing appointment update:', error);
    }
  }

  /**
   * Hook: When an appointment is cancelled
   */
  static async onAppointmentCancelled(appointmentId: string): Promise<void> {
    try {
      const appointment = await prisma.afspraak.findUnique({
        where: { id: appointmentId },
      });

      if (!appointment) return;

      // Mark the slot as available again
      await cacheManager.markSlotAvailable(appointment.datum, appointment.tijd);

      // Invalidate route caches for this date
      await this.invalidateRoutesForDate(appointment.datum);

      console.log(`[CacheHooks] Processed appointment cancellation: ${appointmentId}`);
    } catch (error) {
      console.error('[CacheHooks] Error processing appointment cancellation:', error);
    }
  }

  /**
   * Hook: When a blocked date is added
   */
  static async onBlockedDateAdded(date: Date): Promise<void> {
    try {
      // Invalidate availability for this date
      await cacheManager.invalidateAvailability(date);

      // Update blocked dates cache
      const { availabilityCache } = await import('./availability-cache');
      const blockedDates = await prisma.blockedDate.findMany({
        where: {
          date: {
            gte: startOfDay(new Date()),
          },
        },
      });
      await availabilityCache.updateBlockedDates(blockedDates.map(bd => bd.date));

      console.log(`[CacheHooks] Processed blocked date addition: ${date}`);
    } catch (error) {
      console.error('[CacheHooks] Error processing blocked date addition:', error);
    }
  }

  /**
   * Hook: When a blocked date is removed
   */
  static async onBlockedDateRemoved(date: Date): Promise<void> {
    try {
      // Invalidate availability for this date
      await cacheManager.invalidateAvailability(date);

      // Update blocked dates cache
      const { availabilityCache } = await import('./availability-cache');
      const blockedDates = await prisma.blockedDate.findMany({
        where: {
          date: {
            gte: startOfDay(new Date()),
          },
        },
      });
      await availabilityCache.updateBlockedDates(blockedDates.map(bd => bd.date));

      console.log(`[CacheHooks] Processed blocked date removal: ${date}`);
    } catch (error) {
      console.error('[CacheHooks] Error processing blocked date removal:', error);
    }
  }

  /**
   * Hook: When a customer is updated (address change)
   */
  static async onCustomerUpdated(customerId: string, oldData: any, newData: any): Promise<void> {
    try {
      // Check if address changed
      if (oldData.address !== newData.address || 
          oldData.postalCode !== newData.postalCode ||
          oldData.city !== newData.city) {
        
        // Invalidate old address geocoding
        if (oldData.address && oldData.postalCode) {
          const oldAddress: DutchAddress = {
            street: oldData.address.split(' ').slice(0, -1).join(' '),
            houseNumber: oldData.address.split(' ').pop() || '',
            postalCode: oldData.postalCode,
            city: oldData.city,
          };
          await cacheManager.invalidateGeocoding(oldAddress);
        }

        // Pre-warm new address
        if (newData.address && newData.postalCode) {
          const newAddress: DutchAddress = {
            street: newData.address.split(' ').slice(0, -1).join(' '),
            houseNumber: newData.address.split(' ').pop() || '',
            postalCode: newData.postalCode,
            city: newData.city,
          };
          
          const { geocodingCache } = await import('./geocoding-cache');
          const result = await geocodingCache.get(newAddress);
          if (!result) {
            console.log(`[CacheHooks] Need to geocode updated customer address: ${customerId}`);
          }
        }

        // Invalidate routes for upcoming appointments
        const upcomingAppointments = await prisma.afspraak.findMany({
          where: {
            customerId,
            datum: {
              gte: startOfDay(new Date()),
              lte: addDays(new Date(), 7),
            },
            status: {
              notIn: ['geannuleerd', 'afgerond'],
            },
          },
        });

        for (const apt of upcomingAppointments) {
          await this.invalidateRoutesForDate(apt.datum);
        }
      }

      console.log(`[CacheHooks] Processed customer update: ${customerId}`);
    } catch (error) {
      console.error('[CacheHooks] Error processing customer update:', error);
    }
  }

  /**
   * Hook: When Google Calendar is updated
   */
  static async onCalendarUpdated(startDate: Date, endDate: Date): Promise<void> {
    try {
      // Invalidate availability for the date range
      let current = new Date(startDate);
      while (current <= endDate) {
        await cacheManager.invalidateAvailability(current);
        current = addDays(current, 1);
      }

      console.log(`[CacheHooks] Processed calendar update: ${startDate} to ${endDate}`);
    } catch (error) {
      console.error('[CacheHooks] Error processing calendar update:', error);
    }
  }

  /**
   * Hook: When route cluster is optimized
   */
  static async onRouteClusterOptimized(clusterId: string, optimizedData: any): Promise<void> {
    try {
      const { routeCache } = await import('./route-cache');
      await routeCache.setRouteCluster(clusterId, optimizedData);

      console.log(`[CacheHooks] Cached optimized route cluster: ${clusterId}`);
    } catch (error) {
      console.error('[CacheHooks] Error caching route cluster:', error);
    }
  }

  // === Helper Methods ===

  private static extractAddress(appointment: any): DutchAddress | null {
    if (appointment.customer && appointment.customer.postalCode) {
      return {
        street: appointment.customer.address.split(' ').slice(0, -1).join(' '),
        houseNumber: appointment.customer.address.split(' ').pop() || '',
        postalCode: appointment.customer.postalCode,
        city: appointment.customer.city,
      };
    } else if (appointment.lead && appointment.lead.postcode) {
      return {
        street: appointment.lead.adres?.split(' ').slice(0, -1).join(' ') || '',
        houseNumber: appointment.lead.adres?.split(' ').pop() || '',
        postalCode: appointment.lead.postcode,
        city: appointment.lead.stad || '',
      };
    }
    return null;
  }

  private static async invalidateRoutesForDate(date: Date): Promise<void> {
    // In a real implementation, you would invalidate specific route caches
    // For now, we'll log the intention
    console.log(`[CacheHooks] Would invalidate routes for date: ${date}`);
  }

  private static async updateRouteWarmingPriority(date: Date): Promise<void> {
    // In a real implementation, you would update warming priorities
    // For now, we'll log the intention
    console.log(`[CacheHooks] Would update route warming priority for date: ${date}`);
  }
}

/**
 * Prisma middleware for automatic cache invalidation
 * This should be added to your Prisma client configuration
 */
export function setupPrismaMiddleware(prisma: PrismaClient): void {
  // Appointment changes
  prisma.$use(async (params, next) => {
    const result = await next(params);

    if (params.model === 'Afspraak') {
      switch (params.action) {
        case 'create':
          await CacheHooks.onAppointmentCreated(result.id);
          break;
        case 'update':
          // Note: You'd need to track old data for proper invalidation
          await CacheHooks.onAppointmentUpdated(
            params.args.where.id,
            {}, // oldData would come from a pre-query
            result
          );
          break;
        case 'delete':
          await CacheHooks.onAppointmentCancelled(params.args.where.id);
          break;
      }
    }

    if (params.model === 'BlockedDate') {
      switch (params.action) {
        case 'create':
          await CacheHooks.onBlockedDateAdded(result.date);
          break;
        case 'delete':
          await CacheHooks.onBlockedDateRemoved(params.args.where.date);
          break;
      }
    }

    if (params.model === 'Customer' && params.action === 'update') {
      // Note: You'd need to track old data for proper invalidation
      await CacheHooks.onCustomerUpdated(
        params.args.where.id,
        {}, // oldData would come from a pre-query
        result
      );
    }

    return result;
  });
}