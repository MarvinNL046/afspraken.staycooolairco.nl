import { Handler } from '@netlify/functions';
import { googleMaps } from '../../lib/google-maps';
import { redis } from '../../lib/redis';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';

/**
 * Netlify Function to monitor Google Maps API performance and costs
 * Endpoint: /.netlify/functions/maps-performance
 * Method: GET
 * 
 * Query params:
 * - apiKey: Admin API key for authentication
 * - action: clear-cache (optional)
 * - cacheType: geocoding | routes | matrix (optional, for selective cache clearing)
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('GET, OPTIONS');
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return createErrorResponse(405, 'Method not allowed');
  }

  try {
    // Check admin API key
    const adminApiKey = process.env.ADMIN_API_KEY || 'your-admin-api-key';
    const providedApiKey = event.queryStringParameters?.apiKey;

    if (providedApiKey !== adminApiKey) {
      return createErrorResponse(401, 'Unauthorized');
    }

    // Handle cache clearing action
    const action = event.queryStringParameters?.action;
    if (action === 'clear-cache') {
      const cacheType = event.queryStringParameters?.cacheType as any;
      await googleMaps.clearCache(cacheType);
      
      return createResponse(200, {
        success: true,
        message: cacheType 
          ? `Cache cleared for ${cacheType}`
          : 'All caches cleared',
      });
    }

    // Get performance metrics
    const metrics = googleMaps.getPerformanceMetrics();
    const cacheStats = await redis.getStats();

    // Calculate detailed cost breakdown
    const costBreakdown = {
      geocoding: {
        requests: metrics.recent.filter(m => m.apiType === 'geocoding' && !m.cached).length,
        cachedRequests: metrics.recent.filter(m => m.apiType === 'geocoding' && m.cached).length,
        costPerRequest: 0.005, // $5 per 1000
        totalCost: metrics.recent.filter(m => m.apiType === 'geocoding' && !m.cached).length * 0.005,
      },
      routes: {
        requests: metrics.recent.filter(m => m.apiType === 'routes' && !m.cached).length,
        cachedRequests: metrics.recent.filter(m => m.apiType === 'routes' && m.cached).length,
        costPerRequest: 0.01, // $10 per 1000
        totalCost: metrics.recent.filter(m => m.apiType === 'routes' && !m.cached).length * 0.01,
      },
      matrix: {
        requests: metrics.recent.filter(m => m.apiType === 'matrix' && !m.cached).length,
        cachedRequests: metrics.recent.filter(m => m.apiType === 'matrix' && m.cached).length,
        costPerRequest: 0.01, // $10 per 1000
        totalCost: metrics.recent.filter(m => m.apiType === 'matrix' && !m.cached).length * 0.01,
      },
    };

    // Calculate savings from caching
    const totalCachedRequests = 
      costBreakdown.geocoding.cachedRequests + 
      costBreakdown.routes.cachedRequests + 
      costBreakdown.matrix.cachedRequests;
    
    const estimatedSavings = 
      (costBreakdown.geocoding.cachedRequests * 0.005) +
      (costBreakdown.routes.cachedRequests * 0.01) +
      (costBreakdown.matrix.cachedRequests * 0.01);

    // Performance analysis
    const performanceAnalysis = {
      averageLatency: metrics.summary.averageLatency,
      p95Latency: calculateP95(metrics.recent.map(m => m.latency)),
      errorRate: (metrics.recent.filter(m => m.error).length / metrics.recent.length) * 100,
      cacheEfficiency: {
        hitRate: metrics.summary.cacheHitRate,
        memoryCacheSize: cacheStats.memory.size,
        memoryCacheUtilization: (cacheStats.memory.calculatedSize / cacheStats.memory.maxSize) * 100,
        redisConnected: cacheStats.redis.connected,
      },
    };

    // Daily quota usage
    const dailyQuotaUsage = {
      used: metrics.summary.totalRequests,
      limit: 10000, // Adjust based on your plan
      percentage: (metrics.summary.totalRequests / 10000) * 100,
      remainingRequests: Math.max(0, 10000 - metrics.summary.totalRequests),
    };

    // Response
    const response = {
      summary: {
        totalRequests: metrics.summary.totalRequests,
        totalCost: `$${metrics.summary.totalCost.toFixed(2)}`,
        cacheHitRate: `${metrics.summary.cacheHitRate.toFixed(1)}%`,
        estimatedMonthlyCost: `$${(metrics.summary.totalCost * 30).toFixed(2)}`,
        savingsFromCache: `$${estimatedSavings.toFixed(2)}`,
      },
      costBreakdown,
      performance: performanceAnalysis,
      dailyQuota: dailyQuotaUsage,
      recentActivity: {
        last24Hours: getActivityByHour(metrics.recent),
        topEndpoints: getTopEndpoints(metrics.recent),
      },
      recommendations: generateRecommendations(metrics, performanceAnalysis),
    };

    return createResponse(200, response);

  } catch (error) {
    console.error('Performance monitoring error:', error);

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while fetching performance metrics',
    });
  }
};

// Calculate 95th percentile
function calculateP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(values.length * 0.95) - 1;
  return sorted[index] || 0;
}

// Get activity by hour
function getActivityByHour(metrics: any[]): any {
  const hourlyActivity: { [hour: string]: number } = {};
  const now = new Date();
  
  for (let i = 0; i < 24; i++) {
    hourlyActivity[i.toString().padStart(2, '0')] = 0;
  }

  metrics.forEach(m => {
    const hour = new Date(m.timestamp).getHours();
    hourlyActivity[hour.toString().padStart(2, '0')]++;
  });

  return hourlyActivity;
}

// Get top endpoints by usage
function getTopEndpoints(metrics: any[]): any {
  const endpoints: { [key: string]: number } = {};
  
  metrics.forEach(m => {
    endpoints[m.apiType] = (endpoints[m.apiType] || 0) + 1;
  });

  return Object.entries(endpoints)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
}

// Generate performance recommendations
function generateRecommendations(metrics: any, performance: any): string[] {
  const recommendations: string[] = [];

  // Cache hit rate recommendations
  if (performance.cacheEfficiency.hitRate < 70) {
    recommendations.push('Consider increasing cache TTL to improve hit rate');
  }

  // Latency recommendations
  if (performance.p95Latency > 1000) {
    recommendations.push('High latency detected - consider implementing request batching');
  }

  // Error rate recommendations
  if (performance.errorRate > 1) {
    recommendations.push('Elevated error rate - review API key limits and quotas');
  }

  // Cost recommendations
  if (metrics.summary.totalCost > 50) {
    recommendations.push('High daily cost - consider implementing more aggressive caching');
  }

  // Redis recommendations
  if (!performance.cacheEfficiency.redisConnected) {
    recommendations.push('Redis is not connected - enable for better caching performance');
  }

  // Memory cache recommendations
  if (performance.cacheEfficiency.memoryCacheUtilization > 80) {
    recommendations.push('Memory cache is nearly full - consider increasing cache size');
  }

  return recommendations.length > 0 
    ? recommendations 
    : ['Performance is optimal - no recommendations at this time'];
}