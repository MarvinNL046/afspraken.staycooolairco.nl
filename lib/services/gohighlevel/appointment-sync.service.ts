import { z } from 'zod';

// Sync actions
export type SyncAction = 'create' | 'update' | 'confirm' | 'cancel' | 'complete';

// Sync request schema
const syncRequestSchema = z.object({
  appointmentId: z.string(),
  action: z.enum(['create', 'update', 'confirm', 'cancel', 'complete']),
  timestamp: z.string().optional(),
});

export type SyncRequest = z.infer<typeof syncRequestSchema>;

// Sync response schema
const syncResponseSchema = z.object({
  success: z.boolean(),
  appointmentId: z.string(),
  action: z.string(),
  ghlContactId: z.string().optional(),
  syncDetails: z.object({
    notesCreated: z.boolean().optional(),
    contactUpdated: z.boolean().optional(),
    taskCreated: z.boolean().optional(),
    tagsApplied: z.array(z.string()).optional(),
    customFieldsUpdated: z.record(z.string(), z.any()).optional(),
  }).optional(),
  cached: z.boolean().optional(),
  timestamp: z.string(),
  processingTime: z.number().optional(),
});

export type SyncResponse = z.infer<typeof syncResponseSchema>;

/**
 * GoHighLevel Appointment Sync Service
 * 
 * Handles triggering sync operations to GoHighLevel when
 * appointments are created, updated, or change status.
 */
export class GoHighLevelSyncService {
  private baseUrl: string;
  private syncEndpoint: string;

  constructor(config?: { baseUrl?: string }) {
    this.baseUrl = config?.baseUrl || process.env.NETLIFY_URL || 'http://localhost:8888';
    this.syncEndpoint = '/.netlify/functions/gohighlevel-appointment-sync';
  }

  /**
   * Sync appointment to GoHighLevel
   */
  async syncAppointment(request: SyncRequest): Promise<SyncResponse> {
    const url = `${this.baseUrl}${this.syncEndpoint}`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.message || `Sync failed with status ${response.status}`
        );
      }

      const data = await response.json();
      return syncResponseSchema.parse(data);
      
    } catch (error) {
      console.error('GoHighLevel sync error:', error);
      throw error;
    }
  }

  /**
   * Sync appointment creation
   */
  async syncAppointmentCreation(appointmentId: string): Promise<SyncResponse> {
    return this.syncAppointment({
      appointmentId,
      action: 'create',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Sync appointment confirmation
   */
  async syncAppointmentConfirmation(appointmentId: string): Promise<SyncResponse> {
    return this.syncAppointment({
      appointmentId,
      action: 'confirm',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Sync appointment cancellation
   */
  async syncAppointmentCancellation(appointmentId: string): Promise<SyncResponse> {
    return this.syncAppointment({
      appointmentId,
      action: 'cancel',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Sync appointment completion
   */
  async syncAppointmentCompletion(appointmentId: string): Promise<SyncResponse> {
    return this.syncAppointment({
      appointmentId,
      action: 'complete',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Sync appointment update
   */
  async syncAppointmentUpdate(appointmentId: string): Promise<SyncResponse> {
    return this.syncAppointment({
      appointmentId,
      action: 'update',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Batch sync multiple appointments
   */
  async batchSyncAppointments(
    requests: SyncRequest[]
  ): Promise<Array<{ request: SyncRequest; result: SyncResponse | Error }>> {
    const results = await Promise.allSettled(
      requests.map(request => this.syncAppointment(request))
    );

    return results.map((result, index) => ({
      request: requests[index],
      result: result.status === 'fulfilled' 
        ? result.value 
        : new Error(result.reason?.message || 'Sync failed'),
    }));
  }

  /**
   * Check sync health
   */
  async checkSyncHealth(): Promise<{
    healthy: boolean;
    status: string;
    metrics?: any;
  }> {
    const monitorUrl = `${this.baseUrl}/.netlify/functions/gohighlevel-sync-monitor`;
    
    try {
      const response = await fetch(`${monitorUrl}?action=health`);
      
      if (!response.ok) {
        return {
          healthy: false,
          status: 'API request failed',
        };
      }

      const data = await response.json();
      const health = data.data;
      
      return {
        healthy: health.status === 'healthy',
        status: health.status,
        metrics: health.metrics,
      };
      
    } catch (error) {
      return {
        healthy: false,
        status: 'Network error',
      };
    }
  }
}

// Singleton instance
let syncServiceInstance: GoHighLevelSyncService | null = null;

/**
 * Get GoHighLevel sync service instance
 */
export function getGHLSyncService(): GoHighLevelSyncService {
  if (!syncServiceInstance) {
    syncServiceInstance = new GoHighLevelSyncService();
  }
  return syncServiceInstance;
}

/**
 * Helper function to trigger sync after appointment operations
 * This should be called from appointment creation/update endpoints
 */
export async function triggerAppointmentSync(
  appointmentId: string,
  action: SyncAction,
  options?: {
    async?: boolean;
    retryOnFailure?: boolean;
  }
): Promise<void> {
  const { async = true, retryOnFailure = true } = options || {};
  const syncService = getGHLSyncService();

  const performSync = async () => {
    try {
      await syncService.syncAppointment({
        appointmentId,
        action,
        timestamp: new Date().toISOString(),
      });
      
      console.info('GoHighLevel sync completed', {
        appointmentId,
        action,
      });
    } catch (error) {
      console.error('GoHighLevel sync failed', {
        appointmentId,
        action,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (retryOnFailure) {
        // Schedule retry after 5 minutes
        setTimeout(() => {
          syncService.syncAppointment({
            appointmentId,
            action,
            timestamp: new Date().toISOString(),
          }).catch(retryError => {
            console.error('GoHighLevel sync retry failed', {
              appointmentId,
              action,
              error: retryError instanceof Error ? retryError.message : 'Unknown error',
            });
          });
        }, 5 * 60 * 1000);
      }
    }
  };

  if (async) {
    // Don't wait for sync to complete
    performSync();
  } else {
    // Wait for sync to complete
    await performSync();
  }
}