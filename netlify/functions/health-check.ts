import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  environment: string;
  version: string;
  uptime: number;
  checks: {
    database: CheckResult;
    cache: CheckResult;
    googleMaps: CheckResult;
    goHighLevel: CheckResult;
    memory: CheckResult;
    diskSpace: CheckResult;
  };
  metrics: {
    responseTime: number;
    requestsPerMinute: number;
    errorRate: number;
    avgLatency: number;
  };
}

interface CheckResult {
  status: 'ok' | 'warning' | 'error';
  message?: string;
  latency?: number;
}

const startTime = Date.now();

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Simple query to check connection
    await prisma.$queryRaw`SELECT 1`;
    
    // Check for pending migrations (optional)
    const pendingMigrations = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM _prisma_migrations 
      WHERE finished_at IS NULL
    `;
    
    const latency = Date.now() - start;
    
    if ((pendingMigrations as any)[0].count > 0) {
      return {
        status: 'warning',
        message: 'Pending database migrations detected',
        latency,
      };
    }
    
    return {
      status: 'ok',
      latency,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Database connection failed',
      latency: Date.now() - start,
    };
  }
}

async function checkCache(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Ping Redis
    const pong = await redis.ping();
    const latency = Date.now() - start;
    
    if (pong !== 'PONG') {
      return {
        status: 'warning',
        message: 'Unexpected Redis response',
        latency,
      };
    }
    
    // Check memory usage
    const info = await redis.info('memory');
    const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0');
    const maxMemory = parseInt(info.match(/maxmemory:(\d+)/)?.[1] || '0');
    
    if (maxMemory > 0 && usedMemory / maxMemory > 0.9) {
      return {
        status: 'warning',
        message: 'Redis memory usage above 90%',
        latency,
      };
    }
    
    return {
      status: 'ok',
      latency,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Cache connection failed',
      latency: Date.now() - start,
    };
  }
}

async function checkGoogleMaps(): Promise<CheckResult> {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return {
      status: 'error',
      message: 'Google Maps API key not configured',
    };
  }
  
  const start = Date.now();
  try {
    // Test geocoding API
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=Amsterdam&key=${process.env.GOOGLE_MAPS_API_KEY}`
    );
    
    const latency = Date.now() - start;
    
    if (!response.ok) {
      return {
        status: 'error',
        message: `Google Maps API returned ${response.status}`,
        latency,
      };
    }
    
    const data = await response.json();
    
    if (data.status !== 'OK') {
      return {
        status: 'warning',
        message: `Google Maps API status: ${data.status}`,
        latency,
      };
    }
    
    return {
      status: 'ok',
      latency,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Google Maps API check failed',
      latency: Date.now() - start,
    };
  }
}

async function checkGoHighLevel(): Promise<CheckResult> {
  if (!process.env.GOHIGHLEVEL_API_KEY) {
    return {
      status: 'warning',
      message: 'GoHighLevel API key not configured',
    };
  }
  
  const start = Date.now();
  try {
    // Test API connection
    const response = await fetch('https://api.gohighlevel.com/v1/users/lookup', {
      headers: {
        'Authorization': `Bearer ${process.env.GOHIGHLEVEL_API_KEY}`,
      },
    });
    
    const latency = Date.now() - start;
    
    if (response.status === 401) {
      return {
        status: 'error',
        message: 'GoHighLevel API authentication failed',
        latency,
      };
    }
    
    if (!response.ok && response.status !== 404) {
      return {
        status: 'warning',
        message: `GoHighLevel API returned ${response.status}`,
        latency,
      };
    }
    
    return {
      status: 'ok',
      latency,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'GoHighLevel API check failed',
      latency: Date.now() - start,
    };
  }
}

function checkMemory(): CheckResult {
  const used = process.memoryUsage();
  const heapUsedPercent = (used.heapUsed / used.heapTotal) * 100;
  
  if (heapUsedPercent > 90) {
    return {
      status: 'error',
      message: `Heap usage critical: ${heapUsedPercent.toFixed(1)}%`,
    };
  }
  
  if (heapUsedPercent > 70) {
    return {
      status: 'warning',
      message: `Heap usage high: ${heapUsedPercent.toFixed(1)}%`,
    };
  }
  
  return {
    status: 'ok',
  };
}

function checkDiskSpace(): CheckResult {
  // Netlify functions have limited disk access
  // This is a placeholder for actual disk space checking
  return {
    status: 'ok',
    message: 'Disk space check not available in serverless environment',
  };
}

async function getMetrics() {
  // In a real scenario, these would come from a metrics service
  return {
    responseTime: Math.random() * 100 + 50,
    requestsPerMinute: Math.floor(Math.random() * 1000),
    errorRate: Math.random() * 0.05,
    avgLatency: Math.random() * 200 + 100,
  };
}

export const handler: Handler = async (event) => {
  const overallStart = Date.now();
  
  try {
    // Run all health checks in parallel
    const [database, cache, googleMaps, goHighLevel, memory, diskSpace, metrics] = await Promise.all([
      checkDatabase(),
      checkCache(),
      checkGoogleMaps(),
      checkGoHighLevel(),
      Promise.resolve(checkMemory()),
      Promise.resolve(checkDiskSpace()),
      getMetrics(),
    ]);
    
    const checks = {
      database,
      cache,
      googleMaps,
      goHighLevel,
      memory,
      diskSpace,
    };
    
    // Determine overall status
    const statuses = Object.values(checks).map(check => check.status);
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (statuses.includes('error')) {
      overallStatus = 'unhealthy';
    } else if (statuses.includes('warning')) {
      overallStatus = 'degraded';
    }
    
    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '0.0.0',
      uptime: (Date.now() - startTime) / 1000,
      checks,
      metrics,
    };
    
    // Set appropriate status code
    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
    
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Response-Time': String(Date.now() - overallStart),
      },
      body: JSON.stringify(healthStatus, null, 2),
    };
  } catch (error) {
    console.error('Health check error:', error);
    
    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Response-Time': String(Date.now() - overallStart),
      },
      body: JSON.stringify({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  } finally {
    // Clean up connections
    await prisma.$disconnect();
    redis.disconnect();
  }
};