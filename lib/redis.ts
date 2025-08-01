import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';

// Performance-optimized Redis client with connection pooling
class RedisClient {
  private static instance: RedisClient;
  private client: Redis | null = null;
  private memoryCache: LRUCache<string, any>;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  private constructor() {
    // In-memory LRU cache for ultra-fast access (L1 cache)
    this.memoryCache = new LRUCache<string, any>({
      max: 1000, // Maximum number of items
      ttl: 1000 * 60 * 5, // 5 minutes default TTL
      sizeCalculation: (value) => {
        const str = JSON.stringify(value);
        return str.length;
      },
      maxSize: 10 * 1024 * 1024, // 10MB max size
      updateAgeOnGet: true,
    });
  }

  static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this._connect();
    return this.connectionPromise;
  }

  private async _connect(): Promise<void> {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6380';
      
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        reconnectOnError: (err) => {
          const targetError = 'READONLY';
          if (err.message.includes(targetError)) {
            return true;
          }
          return false;
        },
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('Redis Client Connected');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        console.log('Redis Client Disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      // Don't throw - allow graceful degradation to memory-only cache
      this.client = null;
      this.isConnected = false;
    } finally {
      this.connectionPromise = null;
    }
  }

  // Multi-layer cache get with performance optimization
  async get<T>(key: string): Promise<T | null> {
    // Check L1 cache (memory) first - fastest
    const memoryValue = this.memoryCache.get(key);
    if (memoryValue !== undefined) {
      return memoryValue as T;
    }

    // Check L2 cache (Redis) if available
    if (this.isConnected && this.client) {
      try {
        const value = await this.client.get(key);
        if (value) {
          const parsed = JSON.parse(value);
          // Populate L1 cache for next access
          this.memoryCache.set(key, parsed);
          return parsed as T;
        }
      } catch (error) {
        console.error(`Redis get error for key ${key}:`, error);
      }
    }

    return null;
  }

  // Multi-layer cache set with TTL support
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    // Always set in L1 cache
    this.memoryCache.set(key, value, {
      ttl: ttlSeconds ? ttlSeconds * 1000 : undefined,
    });

    // Set in L2 cache if available
    if (this.isConnected && this.client) {
      try {
        const serialized = JSON.stringify(value);
        if (ttlSeconds) {
          await this.client.setex(key, ttlSeconds, serialized);
        } else {
          await this.client.set(key, serialized);
        }
      } catch (error) {
        console.error(`Redis set error for key ${key}:`, error);
      }
    }
  }

  // Batch get for performance optimization
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    const results: (T | null)[] = [];
    const missingKeys: string[] = [];
    const missingIndices: number[] = [];

    // Check L1 cache first
    for (let i = 0; i < keys.length; i++) {
      const value = this.memoryCache.get(keys[i]);
      if (value !== undefined) {
        results[i] = value as T;
      } else {
        results[i] = null;
        missingKeys.push(keys[i]);
        missingIndices.push(i);
      }
    }

    // Check L2 cache for missing keys
    if (missingKeys.length > 0 && this.isConnected && this.client) {
      try {
        const values = await this.client.mget(...missingKeys);
        for (let i = 0; i < values.length; i++) {
          if (values[i]) {
            const parsed = JSON.parse(values[i] as string);
            results[missingIndices[i]] = parsed as T;
            // Populate L1 cache
            this.memoryCache.set(missingKeys[i], parsed);
          }
        }
      } catch (error) {
        console.error('Redis mget error:', error);
      }
    }

    return results;
  }

  // Delete from all cache layers
  async del(key: string): Promise<void> {
    this.memoryCache.delete(key);
    
    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
      } catch (error) {
        console.error(`Redis del error for key ${key}:`, error);
      }
    }
  }

  // Clear all caches
  async flush(): Promise<void> {
    this.memoryCache.clear();
    
    if (this.isConnected && this.client) {
      try {
        await this.client.flushdb();
      } catch (error) {
        console.error('Redis flush error:', error);
      }
    }
  }

  // Check if key exists
  async exists(key: string): Promise<boolean> {
    if (this.memoryCache.has(key)) {
      return true;
    }

    if (this.isConnected && this.client) {
      try {
        const exists = await this.client.exists(key);
        return exists === 1;
      } catch (error) {
        console.error(`Redis exists error for key ${key}:`, error);
      }
    }

    return false;
  }

  // Set key expiration
  async expire(key: string, seconds: number): Promise<boolean> {
    // Update TTL in memory cache if exists
    const value = this.memoryCache.get(key);
    if (value !== undefined) {
      this.memoryCache.set(key, value, { ttl: seconds * 1000 });
    }

    if (this.isConnected && this.client) {
      try {
        const result = await this.client.expire(key, seconds);
        return result === 1;
      } catch (error) {
        console.error(`Redis expire error for key ${key}:`, error);
      }
    }

    return false;
  }

  // Get cache statistics
  getStats() {
    return {
      memory: {
        size: this.memoryCache.size,
        maxSize: this.memoryCache.maxSize,
        calculatedSize: this.memoryCache.calculatedSize,
      },
      redis: {
        connected: this.isConnected,
      },
    };
  }

  // Graceful shutdown
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
    this.memoryCache.clear();
  }
}

// Export singleton instance
export const redis = RedisClient.getInstance();

// Cache key generators for Google Maps
export const cacheKeys = {
  geocoding: (address: string) => `geo:${address.toLowerCase().replace(/\s+/g, ':')}`,
  routes: (origin: string, destination: string, mode: string) => 
    `route:${origin}:${destination}:${mode}`,
  matrix: (origins: string[], destinations: string[], mode: string) => 
    `matrix:${origins.join('|')}:${destinations.join('|')}:${mode}`,
  placeId: (placeId: string) => `place:${placeId}`,
};

// Cache TTL configurations (in seconds)
export const cacheTTL = {
  geocoding: 30 * 24 * 60 * 60, // 30 days (place IDs are permanent)
  routes: 60 * 60, // 1 hour (traffic-aware)
  matrix: 60 * 60, // 1 hour
  placeId: 365 * 24 * 60 * 60, // 1 year
};

// Helper function to ensure Redis is connected
export async function ensureRedisConnection(): Promise<boolean> {
  try {
    await redis.connect();
    return true;
  } catch (error) {
    console.error('Failed to ensure Redis connection:', error);
    return false;
  }
}