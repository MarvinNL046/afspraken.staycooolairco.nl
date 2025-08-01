import { createClient } from 'redis';

interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export class RateLimiter {
  private redisClient: ReturnType<typeof createClient> | null = null;
  private memoryStore: Map<string, { count: number; resetTime: number }> = new Map();
  
  constructor(private options: RateLimiterOptions) {
    this.initializeRedis();
  }

  private async initializeRedis() {
    if (process.env.REDIS_URL) {
      try {
        this.redisClient = createClient({
          url: process.env.REDIS_URL,
          socket: {
            reconnectStrategy: (retries) => {
              if (retries > 3) return false;
              return Math.min(retries * 100, 3000);
            },
          },
        });

        this.redisClient.on('error', (err) => {
          console.error('Redis client error:', err);
          this.redisClient = null;
        });

        await this.redisClient.connect();
      } catch (error) {
        console.error('Failed to connect to Redis:', error);
        this.redisClient = null;
      }
    }
  }

  async isRateLimited(identifier: string, maxRequests?: number): Promise<boolean> {
    const max = maxRequests || this.options.maxRequests;
    const key = `${this.options.keyPrefix || 'rate-limit'}:${identifier}`;
    const now = Date.now();
    const windowStart = now - this.options.windowMs;

    // Try Redis first
    if (this.redisClient) {
      try {
        // Use Redis sorted sets for sliding window
        const multi = this.redisClient.multi();
        
        // Remove old entries
        multi.zRemRangeByScore(key, '-inf', windowStart.toString());
        
        // Add current request
        multi.zAdd(key, { score: now, value: now.toString() });
        
        // Count requests in window
        multi.zCard(key);
        
        // Set expiry
        multi.expire(key, Math.ceil(this.options.windowMs / 1000));
        
        const results = await multi.exec();
        const count = (results[2] as unknown) as number;
        
        return count > max;
      } catch (error) {
        console.error('Redis rate limit error:', error);
        // Fall back to memory store
      }
    }

    // Memory store fallback
    const record = this.memoryStore.get(key);
    
    if (!record || record.resetTime < now) {
      this.memoryStore.set(key, {
        count: 1,
        resetTime: now + this.options.windowMs,
      });
      return false;
    }

    record.count++;
    return record.count > max;
  }

  async reset(identifier: string): Promise<void> {
    const key = `${this.options.keyPrefix || 'rate-limit'}:${identifier}`;
    
    if (this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch (error) {
        console.error('Redis reset error:', error);
      }
    }
    
    this.memoryStore.delete(key);
  }

  async getRemainingRequests(identifier: string, maxRequests?: number): Promise<number> {
    const max = maxRequests || this.options.maxRequests;
    const key = `${this.options.keyPrefix || 'rate-limit'}:${identifier}`;
    const now = Date.now();
    const windowStart = now - this.options.windowMs;

    if (this.redisClient) {
      try {
        await this.redisClient.zRemRangeByScore(key, '-inf', windowStart.toString());
        const count = await this.redisClient.zCard(key);
        return Math.max(0, max - count);
      } catch (error) {
        console.error('Redis get remaining error:', error);
      }
    }

    const record = this.memoryStore.get(key);
    if (!record || record.resetTime < now) {
      return max;
    }
    
    return Math.max(0, max - record.count);
  }

  // Cleanup old entries periodically
  startCleanup(intervalMs: number = 60000): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.memoryStore.entries()) {
        if (record.resetTime < now) {
          this.memoryStore.delete(key);
        }
      }
    }, intervalMs);
  }
}