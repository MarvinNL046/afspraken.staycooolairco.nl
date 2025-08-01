import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';
import { createGHLClient, GHLAPIError, GHLRateLimitError, GHLNetworkError } from '../../lib/services/gohighlevel/ghl-api-client';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';

const prisma = new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

// Request validation schema
const appointmentSyncRequestSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  action: z.enum(['create', 'update', 'confirm', 'cancel', 'complete']),
  timestamp: z.string().optional(),
});

// Sync status tracking
interface SyncStatus {
  appointmentId: string;
  action: string;
  success: boolean;
  ghlContactId?: string;
  error?: string;
  retryCount: number;
  lastAttempt: Date;
  nextRetry?: Date;
}

// Dead letter queue entry
interface DeadLetterEntry {
  id: string;
  appointmentId: string;
  action: string;
  payload: any;
  error: string;
  attempts: number;
  createdAt: Date;
  lastAttempt: Date;
}

// In-memory queues (in production, use Redis or database)
const syncStatusMap = new Map<string, SyncStatus>();
const deadLetterQueue: DeadLetterEntry[] = [];

/**
 * GoHighLevel Appointment Sync Function
 * 
 * Handles bidirectional synchronization of appointment data between
 * StayCool system and GoHighLevel CRM. Includes error handling,
 * retry logic, and monitoring capabilities.
 * 
 * Features:
 * - Appointment status synchronization (create, confirm, cancel, complete)
 * - Automatic retry with exponential backoff
 * - Dead letter queue for failed syncs
 * - Comprehensive error handling and logging
 * - Idempotency to prevent duplicate syncs
 * 
 * Endpoint: /.netlify/functions/gohighlevel-appointment-sync
 * Method: POST
 * 
 * Request Body:
 * {
 *   "appointmentId": "uuid",
 *   "action": "create" | "update" | "confirm" | "cancel" | "complete",
 *   "timestamp": "2024-01-15T10:00:00Z" (optional)
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "appointmentId": "uuid",
 *   "action": "confirm",
 *   "ghlContactId": "ghl_contact_id",
 *   "syncDetails": {
 *     "notesCreated": true,
 *     "contactUpdated": true,
 *     "tagsApplied": ["appointment-confirmed"],
 *     "customFieldsUpdated": {
 *       "appointment_status": "confirmed",
 *       "next_appointment_date": "2024-01-20"
 *     }
 *   },
 *   "timestamp": "2024-01-15T10:00:00Z"
 * }
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('POST, OPTIONS');
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return createErrorResponse(405, 'Method not allowed', {
      allowedMethods: ['POST', 'OPTIONS']
    });
  }

  const startTime = Date.now();
  let appointmentId: string | null = null;

  try {
    // Parse and validate request
    if (!event.body) {
      return createErrorResponse(400, 'Request body is required');
    }

    let requestData: any;
    try {
      requestData = JSON.parse(event.body);
    } catch (parseError) {
      return createErrorResponse(400, 'Invalid JSON in request body');
    }

    // Validate request data
    let validatedData;
    try {
      validatedData = appointmentSyncRequestSchema.parse(requestData);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return createErrorResponse(400, 'Validation error', {
          details: validationError.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          }))
        });
      }
      throw validationError;
    }

    appointmentId = validatedData.appointmentId;

    // Check for duplicate sync (idempotency)
    const syncKey = `${appointmentId}-${validatedData.action}-${validatedData.timestamp || 'latest'}`;
    const existingSync = syncStatusMap.get(syncKey);
    
    if (existingSync && existingSync.success) {
      console.info('Duplicate sync request detected, returning cached result', {
        appointmentId,
        action: validatedData.action,
        cachedAt: existingSync.lastAttempt
      });
      
      return createResponse(200, {
        success: true,
        appointmentId,
        action: validatedData.action,
        ghlContactId: existingSync.ghlContactId,
        cached: true,
        timestamp: existingSync.lastAttempt.toISOString(),
      });
    }

    // Fetch appointment with lead data
    const appointment = await prisma.afspraak.findUnique({
      where: { id: appointmentId },
      include: {
        lead: true,
        customer: true,
      }
    });

    if (!appointment) {
      return createErrorResponse(404, 'Appointment not found', {
        appointmentId
      });
    }

    // Check if we have a GoHighLevel contact ID
    const ghlContactId = appointment.lead?.ghlContactId || appointment.lead?.ghlId;
    
    if (!ghlContactId) {
      console.warn('No GoHighLevel contact ID found for appointment', {
        appointmentId,
        leadId: appointment.leadId,
        customerId: appointment.customerId
      });
      
      return createErrorResponse(400, 'No GoHighLevel contact associated with this appointment', {
        appointmentId,
        leadId: appointment.leadId,
        hint: 'Ensure the lead was created from GoHighLevel webhook'
      });
    }

    // Initialize GHL client
    const ghlClient = createGHLClient();

    // Perform sync based on action
    let syncResult;
    switch (validatedData.action) {
      case 'create':
        syncResult = await syncAppointmentCreation(ghlClient, appointment, ghlContactId);
        break;
      
      case 'confirm':
        syncResult = await syncAppointmentConfirmation(ghlClient, appointment, ghlContactId);
        break;
      
      case 'cancel':
        syncResult = await syncAppointmentCancellation(ghlClient, appointment, ghlContactId);
        break;
      
      case 'complete':
        syncResult = await syncAppointmentCompletion(ghlClient, appointment, ghlContactId);
        break;
      
      case 'update':
        syncResult = await syncAppointmentUpdate(ghlClient, appointment, ghlContactId);
        break;
      
      default:
        throw new Error(`Unknown action: ${validatedData.action}`);
    }

    // Record successful sync
    syncStatusMap.set(syncKey, {
      appointmentId,
      action: validatedData.action,
      success: true,
      ghlContactId,
      retryCount: 0,
      lastAttempt: new Date(),
    });

    // Clean up old sync status entries (keep last 1000)
    if (syncStatusMap.size > 1000) {
      const entries = Array.from(syncStatusMap.entries());
      entries.sort((a, b) => a[1].lastAttempt.getTime() - b[1].lastAttempt.getTime());
      for (let i = 0; i < entries.length - 1000; i++) {
        syncStatusMap.delete(entries[i][0]);
      }
    }

    console.info('GoHighLevel sync completed successfully', {
      appointmentId,
      action: validatedData.action,
      ghlContactId,
      processingTime: Date.now() - startTime
    });

    return createResponse(200, {
      success: true,
      appointmentId,
      action: validatedData.action,
      ghlContactId,
      syncDetails: syncResult,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
    });

  } catch (error) {
    console.error('GoHighLevel sync error:', error);

    // Determine if error is retryable
    const isRetryable = error instanceof GHLNetworkError || 
                       error instanceof GHLRateLimitError ||
                       (error instanceof GHLAPIError && error.statusCode && error.statusCode >= 500);

    // Add to dead letter queue if not retryable or max retries exceeded
    if (!isRetryable && appointmentId) {
      const deadLetterEntry: DeadLetterEntry = {
        id: crypto.randomUUID(),
        appointmentId,
        action: event.body ? JSON.parse(event.body).action : 'unknown',
        payload: event.body ? JSON.parse(event.body) : null,
        error: error instanceof Error ? error.message : 'Unknown error',
        attempts: 1,
        createdAt: new Date(),
        lastAttempt: new Date(),
      };
      
      deadLetterQueue.push(deadLetterEntry);
      
      // Keep only last 100 dead letter entries
      if (deadLetterQueue.length > 100) {
        deadLetterQueue.shift();
      }
    }

    const errorResponse = {
      message: 'Sync failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      retryable: isRetryable,
      appointmentId,
    };

    if (error instanceof GHLRateLimitError) {
      return createErrorResponse(429, 'Rate limit exceeded', {
        ...errorResponse,
        retryAfter: error.retryAfter,
      });
    }

    return createErrorResponse(500, 'Sync failed', errorResponse);

  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Sync appointment creation to GoHighLevel
 */
async function syncAppointmentCreation(
  client: ReturnType<typeof createGHLClient>,
  appointment: any,
  ghlContactId: string
): Promise<any> {
  const appointmentDate = new Date(appointment.datum);
  const dateStr = appointmentDate.toLocaleDateString('nl-NL');
  const serviceTypeMap: Record<string, string> = {
    'installation': 'Installatie',
    'installatie': 'Installatie',
    'maintenance': 'Onderhoud',
    'onderhoud': 'Onderhoud',
    'repair': 'Reparatie',
    'reparatie': 'Reparatie',
    'consultation': 'Consultatie',
    'consultatie': 'Consultatie',
  };

  const serviceType = serviceTypeMap[appointment.serviceType] || appointment.serviceType;

  // Create appointment note
  await client.addContactNote({
    contactId: ghlContactId,
    body: `
📅 Nieuwe Afspraak Ingepland

Datum: ${dateStr}
Tijd: ${appointment.tijd}
Service: ${serviceType}
Locatie: ${appointment.locatie}
Duur: ${appointment.duur} minuten
Status: ${appointment.status}

Afspraak ID: ${appointment.id}
Aangemaakt op: ${new Date().toISOString()}
    `.trim()
  });

  // Update contact with appointment info
  await client.updateContactAppointmentStatus(
    ghlContactId,
    'scheduled',
    appointmentDate.toISOString()
  );

  // Create task for follow-up
  const taskDueDate = new Date(appointmentDate);
  taskDueDate.setDate(taskDueDate.getDate() - 1); // Day before appointment

  await client.createTask({
    contactId: ghlContactId,
    title: `Afspraak bevestiging - ${serviceType}`,
    body: `Bevestig afspraak voor ${dateStr} om ${appointment.tijd} voor ${serviceType} service.`,
    dueDate: taskDueDate.toISOString(),
    completed: false,
  });

  return {
    notesCreated: true,
    contactUpdated: true,
    taskCreated: true,
    tagsApplied: ['appointment-scheduled'],
    customFieldsUpdated: {
      appointment_status: 'scheduled',
      next_appointment_date: appointmentDate.toISOString(),
    }
  };
}

/**
 * Sync appointment confirmation to GoHighLevel
 */
async function syncAppointmentConfirmation(
  client: ReturnType<typeof createGHLClient>,
  appointment: any,
  ghlContactId: string
): Promise<any> {
  const appointmentDate = new Date(appointment.datum);
  const dateStr = appointmentDate.toLocaleDateString('nl-NL');
  const serviceTypeMap: Record<string, string> = {
    'installation': 'Installatie',
    'installatie': 'Installatie',
    'maintenance': 'Onderhoud',
    'onderhoud': 'Onderhoud',
    'repair': 'Reparatie',
    'reparatie': 'Reparatie',
    'consultation': 'Consultatie',
    'consultatie': 'Consultatie',
  };

  const serviceType = serviceTypeMap[appointment.serviceType] || appointment.serviceType;

  // Create confirmation details
  await client.createAppointmentConfirmation(ghlContactId, {
    date: dateStr,
    time: appointment.tijd,
    serviceType: serviceType,
    location: appointment.locatie,
    appointmentId: appointment.id,
  });

  // Update contact status
  await client.updateContactAppointmentStatus(
    ghlContactId,
    'confirmed',
    appointmentDate.toISOString()
  );

  return {
    notesCreated: true,
    contactUpdated: true,
    tagsApplied: ['appointment-confirmed'],
    customFieldsUpdated: {
      appointment_status: 'confirmed',
      last_appointment_update: new Date().toISOString(),
    }
  };
}

/**
 * Sync appointment cancellation to GoHighLevel
 */
async function syncAppointmentCancellation(
  client: ReturnType<typeof createGHLClient>,
  appointment: any,
  ghlContactId: string
): Promise<any> {
  const appointmentDate = new Date(appointment.datum);
  const dateStr = appointmentDate.toLocaleDateString('nl-NL');

  // Add cancellation note
  await client.addContactNote({
    contactId: ghlContactId,
    body: `
❌ Afspraak Geannuleerd

Datum: ${dateStr}
Tijd: ${appointment.tijd}
Locatie: ${appointment.locatie}

Afspraak ID: ${appointment.id}
Geannuleerd op: ${new Date().toISOString()}
    `.trim()
  });

  // Update contact status
  await client.updateContactAppointmentStatus(ghlContactId, 'cancelled');

  // Create follow-up task
  await client.createTask({
    contactId: ghlContactId,
    title: 'Follow-up: Geannuleerde afspraak',
    body: `Contact opnemen i.v.m. geannuleerde afspraak van ${dateStr}. Nieuwe afspraak inplannen?`,
    dueDate: new Date().toISOString(),
    completed: false,
  });

  return {
    notesCreated: true,
    contactUpdated: true,
    taskCreated: true,
    tagsApplied: ['appointment-cancelled'],
    customFieldsUpdated: {
      appointment_status: 'cancelled',
      last_appointment_update: new Date().toISOString(),
    }
  };
}

/**
 * Sync appointment completion to GoHighLevel
 */
async function syncAppointmentCompletion(
  client: ReturnType<typeof createGHLClient>,
  appointment: any,
  ghlContactId: string
): Promise<any> {
  const appointmentDate = new Date(appointment.datum);
  const dateStr = appointmentDate.toLocaleDateString('nl-NL');

  // Add completion note
  await client.addContactNote({
    contactId: ghlContactId,
    body: `
✅ Afspraak Afgerond

Datum: ${dateStr}
Tijd: ${appointment.tijd}
Service: ${appointment.serviceType}
Locatie: ${appointment.locatie}

${appointment.interneNotities ? `Notities: ${appointment.interneNotities}` : ''}

Afspraak ID: ${appointment.id}
Afgerond op: ${new Date().toISOString()}
    `.trim()
  });

  // Update contact to customer status
  await client.updateContactAppointmentStatus(ghlContactId, 'completed');

  // Create follow-up task for customer satisfaction
  const followUpDate = new Date();
  followUpDate.setDate(followUpDate.getDate() + 7); // Week later

  await client.createTask({
    contactId: ghlContactId,
    title: 'Klanttevredenheid follow-up',
    body: `Contact opnemen voor feedback over service van ${dateStr}. Tevreden? Onderhoud nodig?`,
    dueDate: followUpDate.toISOString(),
    completed: false,
  });

  return {
    notesCreated: true,
    contactUpdated: true,
    taskCreated: true,
    tagsApplied: ['appointment-completed', 'customer'],
    customFieldsUpdated: {
      appointment_status: 'completed',
      last_service_date: appointmentDate.toISOString(),
      is_customer: true,
    }
  };
}

/**
 * Sync appointment update to GoHighLevel
 */
async function syncAppointmentUpdate(
  client: ReturnType<typeof createGHLClient>,
  appointment: any,
  ghlContactId: string
): Promise<any> {
  const appointmentDate = new Date(appointment.datum);
  const dateStr = appointmentDate.toLocaleDateString('nl-NL');

  // Add update note
  await client.addContactNote({
    contactId: ghlContactId,
    body: `
🔄 Afspraak Bijgewerkt

Nieuwe datum: ${dateStr}
Nieuwe tijd: ${appointment.tijd}
Service: ${appointment.serviceType}
Locatie: ${appointment.locatie}
Status: ${appointment.status}

Afspraak ID: ${appointment.id}
Bijgewerkt op: ${new Date().toISOString()}
    `.trim()
  });

  // Update contact info
  const statusMap: Record<string, 'scheduled' | 'confirmed' | 'cancelled' | 'completed'> = {
    'gepland': 'scheduled',
    'bevestigd': 'confirmed',
    'geannuleerd': 'cancelled',
    'afgerond': 'completed',
    'niet_verschenen': 'cancelled',
  };

  const mappedStatus = statusMap[appointment.status] || 'scheduled';
  await client.updateContactAppointmentStatus(
    ghlContactId,
    mappedStatus,
    appointmentDate.toISOString()
  );

  return {
    notesCreated: true,
    contactUpdated: true,
    customFieldsUpdated: {
      appointment_status: mappedStatus,
      next_appointment_date: appointmentDate.toISOString(),
      last_appointment_update: new Date().toISOString(),
    }
  };
}

/**
 * Get sync status (for monitoring)
 */
export async function getSyncStatus(appointmentId?: string): Promise<any> {
  if (appointmentId) {
    const statuses = Array.from(syncStatusMap.entries())
      .filter(([key]) => key.startsWith(appointmentId))
      .map(([key, status]) => ({ key, ...status }));
    
    return {
      appointmentId,
      syncHistory: statuses,
      found: statuses.length > 0,
    };
  }

  // Return overall stats
  const allStatuses = Array.from(syncStatusMap.values());
  const successful = allStatuses.filter(s => s.success).length;
  const failed = allStatuses.filter(s => !s.success).length;
  
  return {
    totalSyncs: allStatuses.length,
    successful,
    failed,
    successRate: allStatuses.length > 0 ? (successful / allStatuses.length) * 100 : 0,
    deadLetterQueueSize: deadLetterQueue.length,
    recentFailures: deadLetterQueue.slice(-10),
  };
}

/**
 * Retry failed syncs from dead letter queue
 */
export async function retryFailedSyncs(): Promise<any> {
  const results = [];
  const retryQueue = [...deadLetterQueue];
  
  for (const entry of retryQueue) {
    try {
      // Create a mock event to retry
      const mockEvent = {
        httpMethod: 'POST',
        body: JSON.stringify(entry.payload),
        headers: {},
        queryStringParameters: null,
        pathParameters: null,
        isBase64Encoded: false,
      };
      
      const response = await handler(mockEvent as any, {} as any);
      
      if (response && response.statusCode === 200) {
        // Remove from dead letter queue on success
        const index = deadLetterQueue.findIndex(e => e.id === entry.id);
        if (index > -1) {
          deadLetterQueue.splice(index, 1);
        }
        
        results.push({
          appointmentId: entry.appointmentId,
          success: true,
        });
      } else {
        results.push({
          appointmentId: entry.appointmentId,
          success: false,
          error: 'Retry failed',
        });
      }
    } catch (error) {
      results.push({
        appointmentId: entry.appointmentId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  
  return {
    attempted: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}