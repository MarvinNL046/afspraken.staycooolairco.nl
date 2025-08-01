import { Handler } from '@netlify/functions';
import { monitoring } from '../../lib/services/monitoring/monitor';
import { degradationManager } from '../../lib/services/graceful-degradation';
import { cacheManager } from '../../lib/services/cache/cache-manager';
import { prisma } from '../../lib/prisma';
import { createResponse, createCorsResponse } from '../../lib/netlify-helpers';

/**
 * Health Check Endpoint
 * Provides comprehensive system health information
 * 
 * GET /.netlify/functions/health - Basic health check
 * GET /.netlify/functions/health?detailed=true - Detailed health information
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('GET, OPTIONS');
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return createResponse(405, { error: 'Method not allowed' });
  }

  const detailed = event.queryStringParameters?.detailed === 'true';
  const startTime = Date.now();

  try {
    if (!detailed) {
      // Basic health check - just return OK
      return createResponse(200, {
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    }

    // Detailed health check
    const healthChecks = await Promise.allSettled([
      checkDatabase(),
      checkCache(),
      checkExternalServices(),
      getSystemMetrics(),
    ]);

    const [database, cache, externalServices, systemMetrics] = healthChecks.map(result => 
      result.status === 'fulfilled' ? result.value : {
        status: 'unhealthy',
        error: result.reason?.message || 'Check failed',
      }
    );

    // Get monitoring data
    const monitoringHealth = await monitoring.health.getSystemHealth();
    const degradationReport = degradationManager.getDegradationReport();

    // Determine overall status
    const overallStatus = determineOverallStatus([
      database,
      cache,
      externalServices,
      ...monitoringHealth.checks,
    ]);

    const response = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.BUILD_ID || 'unknown',
      uptime: process.uptime(),
      responseTime: Date.now() - startTime,
      checks: {
        database,
        cache,
        externalServices,
        system: systemMetrics,
      },
      monitoring: {
        health: monitoringHealth.status,
        checks: monitoringHealth.checks,
      },
      degradation: degradationReport,
    };

    // Set appropriate status code
    const statusCode = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 200 : 503;

    return createResponse(statusCode, response);

  } catch (error) {
    console.error('Health check error:', error);
    
    return createResponse(503, {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Check database health
 */
async function checkDatabase(): Promise<any> {
  const startTime = Date.now();
  
  try {
    // Simple query to check connectivity
    await prisma.$queryRaw`SELECT 1 as healthcheck`;
    
    // Check connection pool (if metrics are available)
    let poolMetrics: any = null;
    try {
      poolMetrics = await (prisma as any).$metrics?.json();
    } catch (e) {
      // Metrics not available
    }
    
    const latency = Date.now() - startTime;
    const status = latency < 100 ? 'healthy' : latency < 500 ? 'degraded' : 'unhealthy';
    
    return {
      status,
      latency,
      message: `Database responding in ${latency}ms`,
      metrics: poolMetrics ? {
        // Extract relevant pool metrics if available
        connections: poolMetrics?.counters?.find((c: any) => c.key === 'prisma_pool_connections_open')?.value || 0,
      } : undefined,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Database connection failed',
      latency: Date.now() - startTime,
    };
  }
}

/**
 * Check cache health
 */
async function checkCache(): Promise<any> {
  try {
    const cacheHealth = await cacheManager.healthCheck();
    const cacheStats = await cacheManager.getStats();
    
    return {
      status: cacheHealth.status,
      redis: cacheHealth.redis,
      stats: {
        hitRate: `${cacheStats.performance.hitRate.toFixed(2)}%`,
        memoryUsage: cacheStats.performance.memoryUsage,
        redisKeys: cacheStats.performance.redisKeys,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Cache check failed',
    };
  }
}

/**
 * Check external services
 */
async function checkExternalServices(): Promise<any> {
  const services = degradationManager.getAllServiceStatuses();
  const serviceChecks: Record<string, any> = {};
  
  services.forEach((status, service) => {
    serviceChecks[service] = {
      status: status.toLowerCase(),
      circuitBreaker: degradationManager.getCircuitBreaker(service).getState(),
    };
  });
  
  // Determine overall external services status
  const statuses = Array.from(services.values());
  const hasOffline = statuses.includes('offline' as any);
  const hasCritical = statuses.includes('critical' as any);
  const hasDegraded = statuses.includes('degraded' as any);
  
  const overallStatus = hasOffline || hasCritical ? 'unhealthy' :
                       hasDegraded ? 'degraded' : 'healthy';
  
  return {
    status: overallStatus,
    services: serviceChecks,
  };
}

/**
 * Get system metrics
 */
async function getSystemMetrics(): Promise<any> {
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  // Convert to MB
  const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
  const rssMB = memoryUsage.rss / 1024 / 1024;
  
  return {
    memory: {
      heapUsed: `${heapUsedMB.toFixed(2)} MB`,
      heapTotal: `${heapTotalMB.toFixed(2)} MB`,
      rss: `${rssMB.toFixed(2)} MB`,
      heapPercentage: `${((heapUsedMB / heapTotalMB) * 100).toFixed(1)}%`,
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system,
    },
    process: {
      pid: process.pid,
      version: process.version,
      uptime: process.uptime(),
    },
  };
}

/**
 * Determine overall health status
 */
function determineOverallStatus(checks: any[]): string {
  const hasUnhealthy = checks.some(check => 
    check.status === 'unhealthy' || check.status === 'UNHEALTHY'
  );
  const hasDegraded = checks.some(check => 
    check.status === 'degraded' || check.status === 'DEGRADED'
  );
  
  if (hasUnhealthy) return 'unhealthy';
  if (hasDegraded) return 'degraded';
  return 'healthy';
}