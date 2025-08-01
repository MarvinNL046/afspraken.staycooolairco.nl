import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';
import { z } from 'zod';

// Cache configuration types
export interface CacheConfig {
  ttl: number;              // TTL in seconds
  maxItems?: number;        // Max items in memory cache
  warmOnStartup?: boolean;  // Pre-warm cache on startup
  compressionThreshold?: number; // Compress values larger than this (bytes)
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
  memoryUsage: number;
  redisKeys: number;
}

// Performance tracking
interface CacheMetrics {
  operation: 'get' | 'set' | 'delete' | 'mget' | 'mset';
  key: string;
  duration: number;
  size?: number;
  hit?: boolean;
  timestamp: Date;
}

// Compression utilities
class CompressionUtil {
  static async compress(data: string): Promise<Buffer> {
    const { gzip } = await import('zlib');
    return new Promise((resolve, reject) => {
      gzip(Buffer.from(data), (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  static async decompress(data: Buffer): Promise<string> {
    const { gunzip } = await import('zlib');
    return new Promise((resolve, reject) => {
      gunzip(data, (err, result) => {
        if (err) reject(err);
        else resolve(result.toString());
      });
    });
  }
}

/**
 * Enhanced Redis Cache Service with intelligent features
 * - Multi-layer caching (Memory L1 + Redis L2)
 * - Compression for large values
 * - Performance monitoring and metrics
 * - Intelligent cache warming
 * - Batch operations optimization
 */
export class RedisCacheService {
  private static instance: RedisCacheService;
  private redis: Redis | null = null;
  private memoryCache: LRUCache<string, any>;
  private stats: CacheStats;
  private metrics: CacheMetrics[] = [];
  private config: Map<string, CacheConfig> = new Map();
  private warmupTasks: Map<string, () => Promise<void>> = new Map();
  private compressionThreshold: number = 1024; // 1KB default

  private constructor() {
    // Initialize memory cache with size-based eviction
    this.memoryCache = new LRUCache<string, any>({
      max: 5000, // Maximum number of items
      maxSize: 50 * 1024 * 1024, // 50MB max size
      sizeCalculation: (value) => {
        try {
          return JSON.stringify(value).length;
        } catch {
          return 1000; // Default size for non-serializable objects
        }
      },
      ttl: 1000 * 60 * 5, // 5 minutes default TTL
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });

    // Initialize stats
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
      memoryUsage: 0,
      redisKeys: 0,
    };

    // Set up periodic stats calculation
    setInterval(() => this.calculateStats(), 30000); // Every 30 seconds
  }

  static getInstance(): RedisCacheService {
    if (!RedisCacheService.instance) {
      RedisCacheService.instance = new RedisCacheService();
    }
    return RedisCacheService.instance;
  }

  /**
   * Initialize Redis connection with optimized settings
   */
  async initialize(redisUrl?: string): Promise<void> {
    const url = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    
    this.redis = new Redis(url, {
      // Connection pool settings
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      keepAlive: 30000,
      
      // Performance optimizations
      enableOfflineQueue: true,
      connectTimeout: 10000,
      commandTimeout: 5000,
      
      // Retry strategy
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      
      // Reconnection handling
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        return err.message.includes(targetError) ? 2 : false;
      },
    });

    // Set up event handlers
    this.redis.on('error', (err) => {
      console.error('[RedisCacheService] Redis error:', err);
    });

    this.redis.on('connect', () => {
      console.log('[RedisCacheService] Redis connected');
    });

    this.redis.on('ready', () => {
      console.log('[RedisCacheService] Redis ready');
      this.runWarmupTasks();
    });

    // Wait for connection
    await this.redis.connect();
  }

  /**
   * Register cache configuration for a specific namespace
   */
  registerNamespace(namespace: string, config: CacheConfig): void {
    this.config.set(namespace, config);
    
    if (config.compressionThreshold) {
      this.compressionThreshold = Math.min(
        this.compressionThreshold,
        config.compressionThreshold
      );
    }
  }

  /**
   * Register a cache warming task
   */
  registerWarmupTask(name: string, task: () => Promise<void>): void {
    this.warmupTasks.set(name, task);
  }

  /**
   * Run all registered warmup tasks
   */
  private async runWarmupTasks(): Promise<void> {
    console.log('[RedisCacheService] Running cache warmup tasks...');
    
    for (const [name, task] of this.warmupTasks) {
      try {
        await task();
        console.log(`[RedisCacheService] Warmup task '${name}' completed`);
      } catch (error) {
        console.error(`[RedisCacheService] Warmup task '${name}' failed:`, error);
      }
    }
  }

  /**
   * Get value with multi-layer caching
   */
  async get<T>(key: string, options?: { parse?: boolean }): Promise<T | null> {
    const startTime = Date.now();
    
    try {
      // Check L1 cache first
      const memoryValue = this.memoryCache.get(key);
      if (memoryValue !== undefined) {
        this.stats.hits++;
        this.recordMetric({
          operation: 'get',
          key,
          duration: Date.now() - startTime,
          hit: true,
          timestamp: new Date(),
        });
        return memoryValue as T;
      }

      // Check L2 cache if Redis is available
      if (!this.redis) {
        this.stats.misses++;
        return null;
      }

      const redisValue = await this.redis.get(key);
      if (!redisValue) {
        this.stats.misses++;
        this.recordMetric({
          operation: 'get',
          key,
          duration: Date.now() - startTime,
          hit: false,
          timestamp: new Date(),
        });
        return null;
      }

      // Handle compressed values
      let parsedValue: T;
      if (redisValue.startsWith('COMPRESSED:')) {
        const compressed = Buffer.from(redisValue.substring(11), 'base64');
        const decompressed = await CompressionUtil.decompress(compressed);
        parsedValue = JSON.parse(decompressed);
      } else {
        parsedValue = options?.parse !== false ? JSON.parse(redisValue) : redisValue as any;
      }

      // Populate L1 cache
      this.memoryCache.set(key, parsedValue);
      
      this.stats.hits++;
      this.recordMetric({
        operation: 'get',
        key,
        duration: Date.now() - startTime,
        hit: true,
        timestamp: new Date(),
      });

      return parsedValue;
    } catch (error) {
      console.error(`[RedisCacheService] Error getting key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value with compression and multi-layer caching
   */
  async set<T>(
    key: string, 
    value: T, 
    options?: { 
      ttl?: number; 
      namespace?: string;
      compress?: boolean;
    }
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Get TTL from namespace config or options
      const namespaceConfig = options?.namespace ? 
        this.config.get(options.namespace) : undefined;
      const ttl = options?.ttl || namespaceConfig?.ttl;

      // Set in L1 cache
      this.memoryCache.set(key, value, {
        ttl: ttl ? ttl * 1000 : undefined,
      });

      // Set in L2 cache if Redis is available
      if (!this.redis) return;

      const serialized = JSON.stringify(value);
      const shouldCompress = options?.compress !== false && 
        serialized.length > this.compressionThreshold;

      let redisValue: string;
      if (shouldCompress) {
        const compressed = await CompressionUtil.compress(serialized);
        redisValue = 'COMPRESSED:' + compressed.toString('base64');
      } else {
        redisValue = serialized;
      }

      if (ttl) {
        await this.redis.setex(key, ttl, redisValue);
      } else {
        await this.redis.set(key, redisValue);
      }

      this.stats.sets++;
      this.recordMetric({
        operation: 'set',
        key,
        duration: Date.now() - startTime,
        size: serialized.length,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error(`[RedisCacheService] Error setting key ${key}:`, error);
    }
  }

  /**
   * Batch get operation with pipeline optimization
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    const startTime = Date.now();
    const results: (T | null)[] = new Array(keys.length).fill(null);
    const missingKeys: { key: string; index: number }[] = [];

    // Check L1 cache first
    for (let i = 0; i < keys.length; i++) {
      const value = this.memoryCache.get(keys[i]);
      if (value !== undefined) {
        results[i] = value as T;
        this.stats.hits++;
      } else {
        missingKeys.push({ key: keys[i], index: i });
      }
    }

    // Fetch missing keys from Redis
    if (missingKeys.length > 0 && this.redis) {
      try {
        const pipeline = this.redis.pipeline();
        missingKeys.forEach(({ key }) => pipeline.get(key));
        const redisResults = await pipeline.exec();

        if (redisResults) {
          for (let i = 0; i < redisResults.length; i++) {
            const [err, value] = redisResults[i];
            if (!err && value) {
              try {
                let parsedValue: T;
                if (typeof value === 'string' && value.startsWith('COMPRESSED:')) {
                  const compressed = Buffer.from(value.substring(11), 'base64');
                  const decompressed = await CompressionUtil.decompress(compressed);
                  parsedValue = JSON.parse(decompressed);
                } else {
                  parsedValue = JSON.parse(value as string);
                }
                
                const { index } = missingKeys[i];
                results[index] = parsedValue;
                
                // Populate L1 cache
                this.memoryCache.set(missingKeys[i].key, parsedValue);
                this.stats.hits++;
              } catch (parseError) {
                this.stats.misses++;
              }
            } else {
              this.stats.misses++;
            }
          }
        }
      } catch (error) {
        console.error('[RedisCacheService] Error in mget:', error);
      }
    }

    this.recordMetric({
      operation: 'mget',
      key: `batch:${keys.length}`,
      duration: Date.now() - startTime,
      hit: results.filter(r => r !== null).length > 0,
      timestamp: new Date(),
    });

    return results;
  }

  /**
   * Batch set operation with pipeline optimization
   */
  async mset<T>(
    entries: Array<{ key: string; value: T; ttl?: number }>,
    options?: { namespace?: string }
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Set in L1 cache
      for (const entry of entries) {
        this.memoryCache.set(entry.key, entry.value, {
          ttl: entry.ttl ? entry.ttl * 1000 : undefined,
        });
      }

      // Set in L2 cache if Redis is available
      if (!this.redis) return;

      const pipeline = this.redis.pipeline();
      
      for (const entry of entries) {
        const serialized = JSON.stringify(entry.value);
        const shouldCompress = serialized.length > this.compressionThreshold;

        let redisValue: string;
        if (shouldCompress) {
          const compressed = await CompressionUtil.compress(serialized);
          redisValue = 'COMPRESSED:' + compressed.toString('base64');
        } else {
          redisValue = serialized;
        }

        if (entry.ttl) {
          pipeline.setex(entry.key, entry.ttl, redisValue);
        } else {
          pipeline.set(entry.key, redisValue);
        }
      }

      await pipeline.exec();
      this.stats.sets += entries.length;

      this.recordMetric({
        operation: 'mset',
        key: `batch:${entries.length}`,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('[RedisCacheService] Error in mset:', error);
    }
  }

  /**
   * Delete key from all cache layers
   */
  async delete(key: string): Promise<void> {
    const startTime = Date.now();
    
    this.memoryCache.delete(key);
    
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch (error) {
        console.error(`[RedisCacheService] Error deleting key ${key}:`, error);
      }
    }

    this.stats.deletes++;
    this.recordMetric({
      operation: 'delete',
      key,
      duration: Date.now() - startTime,
      timestamp: new Date(),
    });
  }

  /**
   * Delete keys by pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    let deletedCount = 0;

    // Clear from memory cache
    for (const key of this.memoryCache.keys()) {
      if (this.matchPattern(key, pattern)) {
        this.memoryCache.delete(key);
        deletedCount++;
      }
    }

    // Clear from Redis
    if (this.redis) {
      try {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          deletedCount += keys.length;
        }
      } catch (error) {
        console.error(`[RedisCacheService] Error deleting pattern ${pattern}:`, error);
      }
    }

    this.stats.deletes += deletedCount;
    return deletedCount;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      memoryUsage: this.memoryCache.calculatedSize,
    };
  }

  /**
   * Get performance metrics
   */
  getMetrics(since?: Date): CacheMetrics[] {
    if (!since) return this.metrics;
    return this.metrics.filter(m => m.timestamp >= since);
  }

  /**
   * Clear all caches
   */
  async flush(): Promise<void> {
    this.memoryCache.clear();
    
    if (this.redis) {
      try {
        await this.redis.flushdb();
      } catch (error) {
        console.error('[RedisCacheService] Error flushing Redis:', error);
      }
    }

    // Reset stats
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
      memoryUsage: 0,
      redisKeys: 0,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.memoryCache.clear();
    
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  /**
   * Calculate cache statistics
   */
  private calculateStats(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    this.stats.memoryUsage = this.memoryCache.calculatedSize;

    // Get Redis key count
    if (this.redis) {
      this.redis.dbsize()
        .then(count => { this.stats.redisKeys = count; })
        .catch(() => { this.stats.redisKeys = 0; });
    }

    // Clean up old metrics (keep last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    this.metrics = this.metrics.filter(m => m.timestamp > oneHourAgo);
  }

  /**
   * Record performance metric
   */
  private recordMetric(metric: CacheMetrics): void {
    this.metrics.push(metric);
    
    // Keep only last 10000 metrics
    if (this.metrics.length > 10000) {
      this.metrics = this.metrics.slice(-5000);
    }
  }

  /**
   * Simple pattern matching for cache key deletion
   */
  private matchPattern(key: string, pattern: string): boolean {
    const regex = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(key);
  }
}

// Export singleton instance
export const cacheService = RedisCacheService.getInstance();