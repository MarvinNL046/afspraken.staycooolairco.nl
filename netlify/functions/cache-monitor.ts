import { Handler } from '@netlify/functions';
import { z, ZodError } from 'zod';
import { cacheManager } from '../../lib/services/cache/cache-manager';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import jwt from 'jsonwebtoken';

// Request validation schemas
const cacheActionSchema = z.object({
  action: z.enum(['stats', 'health', 'flush', 'warm']),
  target: z.enum(['all', 'geocoding', 'availability', 'routes']).optional(),
  adminToken: z.string().min(1, 'Admin authentication required'),
});

/**
 * Netlify Function for cache monitoring and management
 * Endpoint: /.netlify/functions/cache-monitor
 * Methods: GET (stats/health), POST (flush/warm)
 * 
 * Features:
 * - Real-time cache statistics
 * - Health monitoring
 * - Manual cache flushing
 * - Manual cache warming
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('GET, POST, OPTIONS');
  }

  try {
    // GET request - return stats or health
    if (event.httpMethod === 'GET') {
      const action = event.queryStringParameters?.action || 'stats';
      
      if (action === 'health') {
        const health = await cacheManager.healthCheck();
        return createResponse(200, health);
      } else if (action === 'stats') {
        const stats = await cacheManager.getStats();
        
        // Format the response for better readability
        const formattedStats = {
          summary: {
            status: 'operational',
            timestamp: new Date().toISOString(),
            overall: {
              hitRate: `${stats.overall.hitRate.toFixed(2)}%`,
              totalHits: stats.overall.hits,
              totalMisses: stats.overall.misses,
              totalSets: stats.overall.sets,
              memoryUsage: formatBytes(stats.overall.memoryUsage),
              redisKeys: stats.overall.redisKeys,
            },
          },
          performance: {
            hitRate: `${stats.performance.hitRate.toFixed(2)}%`,
            averageLatency: `${stats.performance.averageLatency}ms`,
            memoryUsage: formatBytes(stats.performance.memoryUsage),
            redisKeys: stats.performance.redisKeys,
          },
          services: {
            geocoding: {
              totalCached: stats.geocoding.totalCached,
              frequentAddresses: stats.geocoding.frequentAddresses,
              warmingStatus: stats.geocoding.warmingStatus,
            },
            availability: {
              totalCached: stats.availability.totalCached,
              upcomingDaysCached: stats.availability.upcomingDaysCached,
              invalidationQueueSize: stats.availability.invalidationQueueSize,
              warmingStatus: stats.availability.warmingStatus,
            },
            routes: {
              totalCached: stats.routes.totalCached,
              frequentRoutes: stats.routes.frequentRoutes,
              warmingStatus: stats.routes.warmingStatus,
              types: stats.routes.routeTypes,
            },
          },
          recommendations: generateRecommendations(stats),
        };
        
        return createResponse(200, formattedStats);
      } else {
        return createErrorResponse(400, 'Invalid action parameter');
      }
    }
    
    // POST request - perform cache operations
    if (event.httpMethod === 'POST') {
      if (!event.body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const body = JSON.parse(event.body);
      const validatedData = cacheActionSchema.parse(body);

      // Verify admin token
      const tokenSecret = process.env.JWT_SECRET || 'your-secret-key';
      try {
        const decoded = jwt.verify(validatedData.adminToken, tokenSecret) as any;
        if (!decoded.isAdmin) {
          return createErrorResponse(403, 'Admin privileges required');
        }
      } catch (error) {
        return createErrorResponse(401, 'Invalid or expired admin token');
      }

      // Execute the requested action
      switch (validatedData.action) {
        case 'flush':
          if (validatedData.target === 'all') {
            await cacheManager.flushAll();
            return createResponse(200, {
              success: true,
              message: 'All caches flushed successfully',
              timestamp: new Date().toISOString(),
            });
          } else if (validatedData.target) {
            await cacheManager.flushCache(validatedData.target as any);
            return createResponse(200, {
              success: true,
              message: `${validatedData.target} cache flushed successfully`,
              timestamp: new Date().toISOString(),
            });
          }
          break;

        case 'warm':
          if (validatedData.target === 'all' || !validatedData.target) {
            // Trigger warming asynchronously
            cacheManager.warmAllCaches().catch(console.error);
            return createResponse(202, {
              success: true,
              message: 'Cache warming initiated for all services',
              timestamp: new Date().toISOString(),
              note: 'Warming is running in the background',
            });
          } else {
            // Warm specific cache
            let warmingPromise: Promise<void>;
            switch (validatedData.target) {
              case 'geocoding':
                const { geocodingCache } = await import('../../lib/services/cache/geocoding-cache');
                warmingPromise = geocodingCache.warmCache();
                break;
              case 'availability':
                const { availabilityCache } = await import('../../lib/services/cache/availability-cache');
                warmingPromise = availabilityCache.warmCache();
                break;
              case 'routes':
                const { routeCache } = await import('../../lib/services/cache/route-cache');
                warmingPromise = routeCache.warmCache();
                break;
              default:
                return createErrorResponse(400, 'Invalid target for warming');
            }
            
            warmingPromise.catch(console.error);
            return createResponse(202, {
              success: true,
              message: `${validatedData.target} cache warming initiated`,
              timestamp: new Date().toISOString(),
              note: 'Warming is running in the background',
            });
          }
          break;

        default:
          return createErrorResponse(400, 'Invalid action');
      }
    }

    return createErrorResponse(405, 'Method not allowed');

  } catch (error) {
    console.error('Cache monitor error:', error);

    if (error instanceof ZodError) {
      return createErrorResponse(400, 'Validation error', {
        details: error.issues,
      });
    }

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while processing cache operation',
    });
  }
};

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Generate performance recommendations
function generateRecommendations(stats: any): string[] {
  const recommendations: string[] = [];

  // Check hit rate
  if (stats.overall.hitRate < 70) {
    recommendations.push('Cache hit rate is below 70%. Consider warming more frequently used data.');
  }

  // Check memory usage
  if (stats.overall.memoryUsage > 40 * 1024 * 1024) { // 40MB
    recommendations.push('Memory cache usage is high. Consider adjusting TTL or max items.');
  }

  // Check Redis keys
  if (stats.overall.redisKeys > 100000) {
    recommendations.push('High number of Redis keys. Review TTL settings and cleanup policies.');
  }

  // Service-specific recommendations
  if (stats.availability.invalidationQueueSize > 50) {
    recommendations.push('Large availability invalidation queue. Consider batch processing.');
  }

  if (stats.geocoding.frequentAddresses < 100) {
    recommendations.push('Low number of frequent addresses cached. Enable usage tracking.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Cache performance is optimal. No actions required.');
  }

  return recommendations;
}