/**
 * Health Check API Integration Tests
 * 
 * Tests the health check endpoint with system monitoring integration
 */

import { GET as healthHandler } from '@/app/api/health/route';
import { NextRequest } from 'next/server';
import { MonitoringService } from '@/lib/services/monitoring/monitor';
import { prismaMock } from '@/jest.setup.integration';
import Redis from 'ioredis';

// Mock services
jest.mock('@/lib/services/monitoring/monitor');
jest.mock('ioredis');

describe('Health Check API Integration', () => {
  let mockMonitoring: jest.Mocked<MonitoringService>;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up monitoring mock
    mockMonitoring = {
      checkHealth: jest.fn().mockResolvedValue({
        status: 'healthy',
        uptime: 3600,
        services: {
          database: { status: 'healthy', latency: 5 },
          redis: { status: 'healthy', latency: 2 },
          external: { status: 'healthy' },
        },
        metrics: {
          requestRate: 100,
          errorRate: 0.5,
          averageResponseTime: 150,
          memoryUsage: 256,
          cpuUsage: 25,
        },
      }),
    } as any;
    (MonitoringService as jest.MockedClass<typeof MonitoringService>).mockImplementation(() => mockMonitoring);

    // Set up Redis mock
    mockRedis = {
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn(),
    } as any;
    (Redis as unknown as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedis);
  });

  describe('GET /api/health', () => {
    it('should return healthy status when all services are up', async () => {
      // Mock Prisma $queryRaw to simulate database check
      prismaMock.$queryRaw.mockResolvedValue([{ result: 1 }]);

      const request = new NextRequest('http://localhost:3000/api/health');
      const response = await healthHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        uptime: 3600,
        services: {
          database: { status: 'healthy', latency: 5 },
          redis: { status: 'healthy', latency: 2 },
          external: { status: 'healthy' },
        },
        metrics: {
          requestRate: 100,
          errorRate: 0.5,
          averageResponseTime: 150,
          memoryUsage: 256,
          cpuUsage: 25,
        },
      });
    });

    it('should return degraded status when some services are down', async () => {
      mockMonitoring.checkHealth.mockResolvedValue({
        status: 'degraded',
        uptime: 3600,
        services: {
          database: { status: 'healthy', latency: 5 },
          redis: { status: 'unhealthy', error: 'Connection timeout' },
          external: { status: 'healthy' },
        },
        metrics: {
          requestRate: 100,
          errorRate: 5,
          averageResponseTime: 300,
          memoryUsage: 512,
          cpuUsage: 60,
        },
      });

      const request = new NextRequest('http://localhost:3000/api/health');
      const response = await healthHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('degraded');
      expect(data.services.redis.status).toBe('unhealthy');
    });

    it('should return unhealthy status when critical services are down', async () => {
      mockMonitoring.checkHealth.mockResolvedValue({
        status: 'unhealthy',
        uptime: 3600,
        services: {
          database: { status: 'unhealthy', error: 'Connection lost' },
          redis: { status: 'unhealthy', error: 'Connection timeout' },
          external: { status: 'degraded' },
        },
        metrics: {
          requestRate: 50,
          errorRate: 25,
          averageResponseTime: 1000,
          memoryUsage: 900,
          cpuUsage: 95,
        },
      });

      const request = new NextRequest('http://localhost:3000/api/health');
      const response = await healthHandler(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('unhealthy');
      expect(data.services.database.status).toBe('unhealthy');
    });

    it('should include detailed metrics when requested', async () => {
      const request = new NextRequest('http://localhost:3000/api/health?detailed=true');
      const response = await healthHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.metrics).toBeDefined();
      expect(data.metrics).toHaveProperty('requestRate');
      expect(data.metrics).toHaveProperty('errorRate');
      expect(data.metrics).toHaveProperty('averageResponseTime');
      expect(data.metrics).toHaveProperty('memoryUsage');
      expect(data.metrics).toHaveProperty('cpuUsage');
    });

    it('should handle monitoring service errors gracefully', async () => {
      mockMonitoring.checkHealth.mockRejectedValue(
        new Error('Monitoring service unavailable')
      );

      const request = new NextRequest('http://localhost:3000/api/health');
      const response = await healthHandler(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data).toEqual({
        status: 'unhealthy',
        timestamp: expect.any(String),
        error: 'Health check failed',
      });
    });

    it('should check database connectivity', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ result: 1 }]);

      const request = new NextRequest('http://localhost:3000/api/health');
      await healthHandler(request);

      expect(prismaMock.$queryRaw).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('SELECT 1')])
      );
    });

    it('should handle database check failures', async () => {
      prismaMock.$queryRaw.mockRejectedValue(new Error('Database unreachable'));

      mockMonitoring.checkHealth.mockResolvedValue({
        status: 'unhealthy',
        uptime: 3600,
        services: {
          database: { status: 'unhealthy', error: 'Database unreachable' },
          redis: { status: 'healthy', latency: 2 },
          external: { status: 'healthy' },
        },
        metrics: {
          requestRate: 100,
          errorRate: 10,
          averageResponseTime: 500,
          memoryUsage: 256,
          cpuUsage: 25,
        },
      });

      const request = new NextRequest('http://localhost:3000/api/health');
      const response = await healthHandler(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.services.database.status).toBe('unhealthy');
    });

    it('should check Redis connectivity', async () => {
      const request = new NextRequest('http://localhost:3000/api/health');
      await healthHandler(request);

      expect(mockRedis.ping).toHaveBeenCalled();
    });

    it('should handle Redis check failures', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Redis connection failed'));

      mockMonitoring.checkHealth.mockResolvedValue({
        status: 'degraded',
        uptime: 3600,
        services: {
          database: { status: 'healthy', latency: 5 },
          redis: { status: 'unhealthy', error: 'Redis connection failed' },
          external: { status: 'healthy' },
        },
        metrics: {
          requestRate: 100,
          errorRate: 2,
          averageResponseTime: 200,
          memoryUsage: 256,
          cpuUsage: 25,
        },
      });

      const request = new NextRequest('http://localhost:3000/api/health');
      const response = await healthHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('degraded');
      expect(data.services.redis.status).toBe('unhealthy');
    });

    it('should include version information', async () => {
      process.env.APP_VERSION = '1.2.3';
      process.env.NODE_ENV = 'production';

      const request = new NextRequest('http://localhost:3000/api/health');
      const response = await healthHandler(request);
      const data = await response.json();

      expect(data.version).toBe('1.2.3');
      expect(data.environment).toBe('production');

      delete process.env.APP_VERSION;
    });

    it('should calculate proper HTTP status codes', async () => {
      // Healthy - 200
      mockMonitoring.checkHealth.mockResolvedValue({
        status: 'healthy',
        uptime: 3600,
        services: {
          database: { status: 'healthy' },
          redis: { status: 'healthy' },
          external: { status: 'healthy' },
        },
        metrics: {},
      });

      let request = new NextRequest('http://localhost:3000/api/health');
      let response = await healthHandler(request);
      expect(response.status).toBe(200);

      // Degraded - 200
      mockMonitoring.checkHealth.mockResolvedValue({
        status: 'degraded',
        uptime: 3600,
        services: {
          database: { status: 'healthy' },
          redis: { status: 'degraded' },
          external: { status: 'healthy' },
        },
        metrics: {},
      });

      request = new NextRequest('http://localhost:3000/api/health');
      response = await healthHandler(request);
      expect(response.status).toBe(200);

      // Unhealthy - 503
      mockMonitoring.checkHealth.mockResolvedValue({
        status: 'unhealthy',
        uptime: 3600,
        services: {
          database: { status: 'unhealthy' },
          redis: { status: 'unhealthy' },
          external: { status: 'unhealthy' },
        },
        metrics: {},
      });

      request = new NextRequest('http://localhost:3000/api/health');
      response = await healthHandler(request);
      expect(response.status).toBe(503);
    });

    it('should not expose sensitive information in production', async () => {
      process.env.NODE_ENV = 'production';

      mockMonitoring.checkHealth.mockRejectedValue(
        new Error('Database password incorrect: mypassword123')
      );

      const request = new NextRequest('http://localhost:3000/api/health');
      const response = await healthHandler(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe('Health check failed');
      expect(JSON.stringify(data)).not.toContain('mypassword123');

      process.env.NODE_ENV = 'test';
    });
  });
});