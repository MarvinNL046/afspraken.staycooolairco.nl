import { Handler } from '@netlify/functions';
import { z } from 'zod';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import { getSyncStatus, retryFailedSyncs } from './gohighlevel-appointment-sync';

// Query parameter schemas
const monitorQuerySchema = z.object({
  action: z.enum(['status', 'retry', 'health']).optional().default('status'),
  appointmentId: z.string().optional(),
});

/**
 * GoHighLevel Sync Monitoring Function
 * 
 * Provides monitoring, analytics, and manual control over the
 * GoHighLevel appointment sync system.
 * 
 * Features:
 * - View sync status and history
 * - Monitor dead letter queue
 * - Manually retry failed syncs
 * - Health check endpoint
 * - Performance analytics
 * 
 * Endpoint: /.netlify/functions/gohighlevel-sync-monitor
 * Method: GET
 * 
 * Query Parameters:
 * - action: "status" | "retry" | "health" (default: "status")
 * - appointmentId: Filter status by specific appointment
 * 
 * Examples:
 * GET ?action=status - Get overall sync status
 * GET ?action=status&appointmentId=uuid - Get status for specific appointment
 * GET ?action=retry - Retry all failed syncs
 * GET ?action=health - Get system health check
 * 
 * Response (status):
 * {
 *   "success": true,
 *   "action": "status",
 *   "data": {
 *     "totalSyncs": 150,
 *     "successful": 145,
 *     "failed": 5,
 *     "successRate": 96.67,
 *     "deadLetterQueueSize": 5,
 *     "recentFailures": [...],
 *     "systemHealth": {
 *       "status": "healthy",
 *       "issues": []
 *     }
 *   }
 * }
 * 
 * Response (retry):
 * {
 *   "success": true,
 *   "action": "retry",
 *   "data": {
 *     "attempted": 5,
 *     "successful": 3,
 *     "failed": 2,
 *     "results": [...]
 *   }
 * }
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('GET, OPTIONS');
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return createErrorResponse(405, 'Method not allowed', {
      allowedMethods: ['GET', 'OPTIONS']
    });
  }

  const startTime = Date.now();

  try {
    // Parse query parameters
    const params = event.queryStringParameters || {};
    let validatedParams;
    
    try {
      validatedParams = monitorQuerySchema.parse({
        action: params.action,
        appointmentId: params.appointmentId,
      });
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return createErrorResponse(400, 'Invalid query parameters', {
          details: validationError.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          }))
        });
      }
      throw validationError;
    }

    let responseData;

    switch (validatedParams.action) {
      case 'status':
        responseData = await handleStatusRequest(validatedParams.appointmentId);
        break;

      case 'retry':
        responseData = await handleRetryRequest();
        break;

      case 'health':
        responseData = await handleHealthCheck();
        break;

      default:
        return createErrorResponse(400, 'Invalid action');
    }

    return createResponse(200, {
      success: true,
      action: validatedParams.action,
      data: responseData,
      metadata: {
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
      }
    });

  } catch (error) {
    console.error('Sync monitor error:', error);

    return createErrorResponse(500, 'Monitor request failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Handle status request
 */
async function handleStatusRequest(appointmentId?: string): Promise<any> {
  const syncStatus = await getSyncStatus(appointmentId);
  
  if (appointmentId) {
    return syncStatus;
  }

  // Add system health info for overall status
  const healthCheck = await performHealthCheck();
  
  return {
    ...syncStatus,
    systemHealth: healthCheck,
    recommendations: generateRecommendations(syncStatus, healthCheck),
  };
}

/**
 * Handle retry request
 */
async function handleRetryRequest(): Promise<any> {
  // Check authorization (in production, implement proper auth)
  // For now, we'll allow retries but log them
  console.warn('Manual retry initiated', {
    timestamp: new Date().toISOString(),
    source: 'sync-monitor',
  });

  const retryResults = await retryFailedSyncs();
  
  return {
    ...retryResults,
    warning: 'Manual retries should be used sparingly. Consider investigating root causes of failures.',
  };
}

/**
 * Handle health check
 */
async function handleHealthCheck(): Promise<any> {
  const healthData = await performHealthCheck();
  const syncStatus = await getSyncStatus();
  
  return {
    ...healthData,
    metrics: {
      totalSyncs: syncStatus.totalSyncs,
      successRate: syncStatus.successRate,
      deadLetterQueueSize: syncStatus.deadLetterQueueSize,
    },
    recommendations: generateRecommendations(syncStatus, healthData),
  };
}

/**
 * Perform system health check
 */
async function performHealthCheck(): Promise<any> {
  const issues: string[] = [];
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  // Check environment variables
  const requiredEnvVars = [
    'GHL_API_KEY',
    'DATABASE_URL',
    'JWT_SECRET',
  ];

  const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingEnvVars.length > 0) {
    issues.push(`Missing environment variables: ${missingEnvVars.join(', ')}`);
    status = 'unhealthy';
  }

  // Check sync performance
  const syncStatus = await getSyncStatus();
  if (syncStatus.successRate < 90) {
    issues.push(`Low sync success rate: ${syncStatus.successRate.toFixed(2)}%`);
    status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
  }

  if (syncStatus.deadLetterQueueSize > 50) {
    issues.push(`High dead letter queue size: ${syncStatus.deadLetterQueueSize} failed syncs`);
    status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
  }

  // Check recent failure patterns
  if (syncStatus.recentFailures && syncStatus.recentFailures.length > 0) {
    const recentFailures = syncStatus.recentFailures;
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);
    const recentHourFailures = recentFailures.filter((f: any) => 
      new Date(f.lastAttempt) > lastHour
    );
    
    if (recentHourFailures.length > 10) {
      issues.push(`High failure rate in last hour: ${recentHourFailures.length} failures`);
      status = 'degraded';
    }
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    issues,
    checks: {
      environment: missingEnvVars.length === 0,
      syncPerformance: syncStatus.successRate >= 90,
      deadLetterQueue: syncStatus.deadLetterQueueSize <= 50,
      recentFailures: true, // Placeholder for now
    }
  };
}

/**
 * Generate recommendations based on system state
 */
function generateRecommendations(syncStatus: any, healthCheck: any): string[] {
  const recommendations: string[] = [];

  // Low success rate
  if (syncStatus.successRate < 90) {
    recommendations.push('Investigate sync failures - success rate below 90%');
    recommendations.push('Check GoHighLevel API status and rate limits');
  }

  // High dead letter queue
  if (syncStatus.deadLetterQueueSize > 20) {
    recommendations.push(`Clear dead letter queue - ${syncStatus.deadLetterQueueSize} items pending`);
    recommendations.push('Consider manual retry or investigation of persistent failures');
  }

  // Recent failure patterns
  if (syncStatus.recentFailures && syncStatus.recentFailures.length > 5) {
    const errorTypes = new Set(syncStatus.recentFailures.map((f: any) => f.error));
    if (errorTypes.has('Rate limit exceeded')) {
      recommendations.push('Rate limiting detected - consider spreading sync operations');
    }
    if (errorTypes.has('Network timeout')) {
      recommendations.push('Network issues detected - check connectivity to GoHighLevel');
    }
  }

  // Health check issues
  if (healthCheck.status === 'unhealthy') {
    recommendations.push('URGENT: System health check failed - immediate attention required');
  } else if (healthCheck.status === 'degraded') {
    recommendations.push('System performance degraded - review identified issues');
  }

  // No issues
  if (recommendations.length === 0) {
    recommendations.push('System operating normally - no action required');
  }

  return recommendations;
}

/**
 * Export monitoring data for external systems
 */
export function getMonitoringMetrics(): any {
  // This could be called by monitoring systems like Datadog, New Relic, etc.
  return getSyncStatus().then(status => ({
    'ghl_sync.total': status.totalSyncs,
    'ghl_sync.successful': status.successful,
    'ghl_sync.failed': status.failed,
    'ghl_sync.success_rate': status.successRate,
    'ghl_sync.dead_letter_queue_size': status.deadLetterQueueSize,
    'ghl_sync.timestamp': Date.now(),
  }));
}