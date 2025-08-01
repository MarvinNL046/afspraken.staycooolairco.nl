/**
 * Cache Service Unit Tests
 * 
 * Tests caching functionality, TTL management, and cache invalidation
 */

import { CacheService } from '@/lib/services/cache';
import Redis from 'ioredis';
import { Logger } from '@/lib/services/logging/logger';
import { MonitoringService } from '@/lib/services/monitoring/monitor';

// Mock dependencies
jest.mock('ioredis');
jest.mock('@/lib/services/logging/logger');
jest.mock('@/lib/services/monitoring/monitor');

describe('CacheService', () => {
  let cacheService: CacheService;
  let mockRedis: jest.Mocked<Redis>;
  let mockLogger: jest.Mocked<Logger>;
  let mockMonitoring: jest.Mocked<MonitoringService>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock Redis instance
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
      keys: jest.fn(),
      mget: jest.fn(),
      mset: jest.fn(),
      pipeline: jest.fn(),
      quit: jest.fn(),
      on: jest.fn(),
    } as any;

    // Create mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Create mock monitoring
    mockMonitoring = {
      recordCacheOperation: jest.fn(),
    } as any;

    // Set up Redis mock
    (Redis as unknown as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedis);
    (Logger as jest.MockedClass<typeof Logger>).mockImplementation(() => mockLogger);
    (MonitoringService as jest.MockedClass<typeof MonitoringService>).mockImplementation(() => mockMonitoring);

    // Create cache service instance
    cacheService = new CacheService({
      redisUrl: 'redis://localhost:6379',
      defaultTTL: 3600,
      keyPrefix: 'test:',
    });
  });

  afterEach(() => {
    cacheService.disconnect();
  });

  describe('get', () => {
    it('should return cached value on hit', async () => {
      const cachedData = { id: 1, name: 'Test' };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await cacheService.get('test-key');

      expect(result).toEqual(cachedData);
      expect(mockRedis.get).toHaveBeenCalledWith('test:test-key');
      expect(mockMonitoring.recordCacheOperation).toHaveBeenCalledWith(
        'get',
        true,
        expect.any(Number)
      );
    });

    it('should return null on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await cacheService.get('missing-key');

      expect(result).toBeNull();
      expect(mockMonitoring.recordCacheOperation).toHaveBeenCalledWith(
        'get',
        false,
        expect.any(Number)
      );
    });

    it('should handle JSON parse errors', async () => {
      mockRedis.get.mockResolvedValue('invalid json');

      const result = await cacheService.get('bad-json');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache parse error',
        expect.any(Error),
        expect.objectContaining({ key: 'test:bad-json' })
      );
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection error'));

      const result = await cacheService.get('error-key');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache get error',
        expect.any(Error),
        expect.objectContaining({ key: 'test:error-key' })
      );
    });
  });

  describe('set', () => {
    it('should store value with default TTL', async () => {
      const data = { id: 1, name: 'Test' };
      mockRedis.set.mockResolvedValue('OK');

      const result = await cacheService.set('test-key', data);

      expect(result).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'test:test-key',
        JSON.stringify(data),
        'EX',
        3600
      );
      expect(mockMonitoring.recordCacheOperation).toHaveBeenCalledWith(
        'set',
        true,
        expect.any(Number)
      );
    });

    it('should store value with custom TTL', async () => {
      const data = { id: 1, name: 'Test' };
      mockRedis.set.mockResolvedValue('OK');

      const result = await cacheService.set('test-key', data, 7200);

      expect(result).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'test:test-key',
        JSON.stringify(data),
        'EX',
        7200
      );
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis connection error'));

      const result = await cacheService.set('error-key', { data: 'test' });

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache set error',
        expect.any(Error),
        expect.objectContaining({ key: 'test:error-key' })
      );
    });

    it('should handle circular references in data', async () => {
      const circularData: any = { id: 1 };
      circularData.self = circularData;

      const result = await cacheService.set('circular-key', circularData);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache set error',
        expect.any(Error),
        expect.objectContaining({ key: 'test:circular-key' })
      );
    });
  });

  describe('delete', () => {
    it('should delete single key', async () => {
      mockRedis.del.mockResolvedValue(1);

      const result = await cacheService.delete('test-key');

      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('test:test-key');
      expect(mockMonitoring.recordCacheOperation).toHaveBeenCalledWith(
        'delete',
        true,
        expect.any(Number)
      );
    });

    it('should delete multiple keys', async () => {
      mockRedis.del.mockResolvedValue(3);

      const result = await cacheService.delete(['key1', 'key2', 'key3']);

      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('test:key1', 'test:key2', 'test:key3');
    });

    it('should return false if no keys deleted', async () => {
      mockRedis.del.mockResolvedValue(0);

      const result = await cacheService.delete('non-existent');

      expect(result).toBe(false);
      expect(mockMonitoring.recordCacheOperation).toHaveBeenCalledWith(
        'delete',
        false,
        expect.any(Number)
      );
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis connection error'));

      const result = await cacheService.delete('error-key');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache delete error',
        expect.any(Error),
        expect.objectContaining({ keys: ['test:error-key'] })
      );
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      mockRedis.exists.mockResolvedValue(1);

      const result = await cacheService.exists('test-key');

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('test:test-key');
    });

    it('should return false for non-existing key', async () => {
      mockRedis.exists.mockResolvedValue(0);

      const result = await cacheService.exists('missing-key');

      expect(result).toBe(false);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.exists.mockRejectedValue(new Error('Redis connection error'));

      const result = await cacheService.exists('error-key');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache exists error',
        expect.any(Error),
        expect.objectContaining({ key: 'test:error-key' })
      );
    });
  });

  describe('getTTL', () => {
    it('should return TTL for existing key', async () => {
      mockRedis.ttl.mockResolvedValue(300);

      const result = await cacheService.getTTL('test-key');

      expect(result).toBe(300);
      expect(mockRedis.ttl).toHaveBeenCalledWith('test:test-key');
    });

    it('should return -1 for non-existing key', async () => {
      mockRedis.ttl.mockResolvedValue(-2);

      const result = await cacheService.getTTL('missing-key');

      expect(result).toBe(-1);
    });

    it('should return -1 for key without expiry', async () => {
      mockRedis.ttl.mockResolvedValue(-1);

      const result = await cacheService.getTTL('permanent-key');

      expect(result).toBe(-1);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.ttl.mockRejectedValue(new Error('Redis connection error'));

      const result = await cacheService.getTTL('error-key');

      expect(result).toBe(-1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache TTL error',
        expect.any(Error),
        expect.objectContaining({ key: 'test:error-key' })
      );
    });
  });

  describe('clear', () => {
    it('should clear all cache keys with prefix', async () => {
      mockRedis.keys.mockResolvedValue(['test:key1', 'test:key2', 'test:key3']);
      mockRedis.del.mockResolvedValue(3);

      const result = await cacheService.clear();

      expect(result).toBe(3);
      expect(mockRedis.keys).toHaveBeenCalledWith('test:*');
      expect(mockRedis.del).toHaveBeenCalledWith('test:key1', 'test:key2', 'test:key3');
      expect(mockLogger.info).toHaveBeenCalledWith('Cache cleared', { keysDeleted: 3 });
    });

    it('should handle no keys to clear', async () => {
      mockRedis.keys.mockResolvedValue([]);

      const result = await cacheService.clear();

      expect(result).toBe(0);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.keys.mockRejectedValue(new Error('Redis connection error'));

      const result = await cacheService.clear();

      expect(result).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache clear error',
        expect.any(Error),
        expect.objectContaining({ pattern: 'test:*' })
      );
    });
  });

  describe('clearPattern', () => {
    it('should clear keys matching pattern', async () => {
      mockRedis.keys.mockResolvedValue(['test:user:1', 'test:user:2']);
      mockRedis.del.mockResolvedValue(2);

      const result = await cacheService.clearPattern('user:*');

      expect(result).toBe(2);
      expect(mockRedis.keys).toHaveBeenCalledWith('test:user:*');
      expect(mockRedis.del).toHaveBeenCalledWith('test:user:1', 'test:user:2');
    });

    it('should handle pattern with no matches', async () => {
      mockRedis.keys.mockResolvedValue([]);

      const result = await cacheService.clearPattern('nonexistent:*');

      expect(result).toBe(0);
    });
  });

  describe('getMultiple', () => {
    it('should get multiple values', async () => {
      const data1 = { id: 1, name: 'Test 1' };
      const data2 = { id: 2, name: 'Test 2' };
      mockRedis.mget.mockResolvedValue([JSON.stringify(data1), null, JSON.stringify(data2)]);

      const result = await cacheService.getMultiple(['key1', 'key2', 'key3']);

      expect(result).toEqual({
        'key1': data1,
        'key2': null,
        'key3': data2,
      });
      expect(mockRedis.mget).toHaveBeenCalledWith('test:key1', 'test:key2', 'test:key3');
    });

    it('should handle empty key array', async () => {
      const result = await cacheService.getMultiple([]);

      expect(result).toEqual({});
      expect(mockRedis.mget).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.mget.mockRejectedValue(new Error('Redis connection error'));

      const result = await cacheService.getMultiple(['key1', 'key2']);

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache getMultiple error',
        expect.any(Error),
        expect.any(Object)
      );
    });
  });

  describe('setMultiple', () => {
    it('should set multiple values', async () => {
      const pipeline = {
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([['OK'], ['OK']]),
      };
      mockRedis.pipeline.mockReturnValue(pipeline as any);

      const data = {
        'key1': { id: 1, name: 'Test 1' },
        'key2': { id: 2, name: 'Test 2' },
      };

      const result = await cacheService.setMultiple(data, 1800);

      expect(result).toBe(true);
      expect(pipeline.set).toHaveBeenCalledWith(
        'test:key1',
        JSON.stringify(data.key1),
        'EX',
        1800
      );
      expect(pipeline.set).toHaveBeenCalledWith(
        'test:key2',
        JSON.stringify(data.key2),
        'EX',
        1800
      );
      expect(pipeline.exec).toHaveBeenCalled();
    });

    it('should use default TTL when not specified', async () => {
      const pipeline = {
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([['OK']]),
      };
      mockRedis.pipeline.mockReturnValue(pipeline as any);

      const data = { 'key1': { id: 1 } };

      await cacheService.setMultiple(data);

      expect(pipeline.set).toHaveBeenCalledWith(
        'test:key1',
        JSON.stringify(data.key1),
        'EX',
        3600
      );
    });

    it('should handle empty data object', async () => {
      const result = await cacheService.setMultiple({});

      expect(result).toBe(true);
      expect(mockRedis.pipeline).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      const pipeline = {
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Redis connection error')),
      };
      mockRedis.pipeline.mockReturnValue(pipeline as any);

      const result = await cacheService.setMultiple({ 'key1': { id: 1 } });

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache setMultiple error',
        expect.any(Error),
        expect.any(Object)
      );
    });
  });

  describe('disconnect', () => {
    it('should disconnect from Redis', async () => {
      mockRedis.quit.mockResolvedValue('OK');

      await cacheService.disconnect();

      expect(mockRedis.quit).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Cache disconnected');
    });

    it('should handle disconnect errors', async () => {
      mockRedis.quit.mockRejectedValue(new Error('Disconnect error'));

      await cacheService.disconnect();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache disconnect error',
        expect.any(Error)
      );
    });
  });
});