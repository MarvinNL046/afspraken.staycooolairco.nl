import { PrismaClient } from '@prisma/client';

/**
 * Database Connection Pool Manager for Netlify Functions
 * 
 * Netlify Functions are stateless and can't maintain traditional database pools,
 * but we can optimize connection management and reuse connections when possible.
 * 
 * Features:
 * - Connection caching and reuse
 * - Automatic connection cleanup
 * - Health monitoring
 * - Performance metrics
 * - Error recovery
 */

interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  connectionErrors: number;
  averageConnectionTime: number;
  lastConnectionTime: Date | null;
  lastError: Error | null;
}

interface CachedConnection {
  prisma: PrismaClient;
  createdAt: Date;
  lastUsed: Date;
  useCount: number;
  isHealthy: boolean;
}

class DatabasePool {
  private connections = new Map<string, CachedConnection>();
  private metrics: ConnectionMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    connectionErrors: 0,
    averageConnectionTime: 0,
    lastConnectionTime: null,
    lastError: null,
  };
  
  private readonly maxConnectionAge = 10 * 60 * 1000; // 10 minutes
  private readonly maxConnections = 5; // Max cached connections
  private readonly healthCheckInterval = 30 * 1000; // 30 seconds
  private readonly connectionTimeout = 10 * 1000; // 10 seconds
  
  constructor() {
    // Periodic cleanup of stale connections
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 60 * 1000); // Every minute
    
    // Health monitoring
    setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckInterval);
    
    // Graceful shutdown handling
    process.on('SIGTERM', () => {
      this.shutdown();
    });
    
    process.on('SIGINT', () => {
      this.shutdown();
    });
  }
  
  /**
   * Get or create a database connection
   */
  async getConnection(connectionId: string = 'default'): Promise<PrismaClient> {
    const startTime = Date.now();
    
    try {
      // Check if we have a healthy cached connection
      const cached = this.connections.get(connectionId);
      if (cached && this.isConnectionValid(cached)) {
        cached.lastUsed = new Date();
        cached.useCount++;
        
        console.log(`[DatabasePool] Reusing connection ${connectionId} (used ${cached.useCount} times)`);
        return cached.prisma;
      }
      
      // Remove stale connection if exists
      if (cached) {
        await this.closeConnection(connectionId);
      }
      
      // Create new connection
      const prisma = await this.createNewConnection();
      const connection: CachedConnection = {
        prisma,
        createdAt: new Date(),
        lastUsed: new Date(),
        useCount: 1,
        isHealthy: true,
      };
      
      this.connections.set(connectionId, connection);
      this.metrics.totalConnections++;
      this.metrics.activeConnections++;
      this.metrics.lastConnectionTime = new Date();
      
      // Update average connection time
      const connectionTime = Date.now() - startTime;
      this.metrics.averageConnectionTime = 
        (this.metrics.averageConnectionTime + connectionTime) / 2;
      
      console.log(`[DatabasePool] Created new connection ${connectionId} in ${connectionTime}ms`);
      
      return prisma;
    } catch (error) {
      this.metrics.connectionErrors++;
      this.metrics.lastError = error instanceof Error ? error : new Error('Unknown connection error');
      
      console.error(`[DatabasePool] Failed to get connection ${connectionId}:`, error);
      throw error;
    }
  }
  
  /**
   * Create a new Prisma client with optimized configuration
   */
  private async createNewConnection(): Promise<PrismaClient> {
    const prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' 
        ? ['error', 'warn'] 
        : ['error'],
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      },
    });
    
    // Set connection timeout
    const connectPromise = prisma.$connect();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), this.connectionTimeout);
    });
    
    await Promise.race([connectPromise, timeoutPromise]);
    
    // Test the connection
    await prisma.$queryRaw`SELECT 1`;
    
    return prisma;
  }
  
  /**
   * Check if a cached connection is still valid
   */
  private isConnectionValid(connection: CachedConnection): boolean {
    const now = new Date();
    const age = now.getTime() - connection.createdAt.getTime();
    const timeSinceLastUse = now.getTime() - connection.lastUsed.getTime();
    
    return (
      connection.isHealthy &&
      age < this.maxConnectionAge &&
      timeSinceLastUse < this.maxConnectionAge / 2 // Half the max age for last use
    );
  }
  
  /**
   * Close a specific connection
   */
  async closeConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        await connection.prisma.$disconnect();
        console.log(`[DatabasePool] Closed connection ${connectionId}`);
      } catch (error) {
        console.warn(`[DatabasePool] Error closing connection ${connectionId}:`, error);
      } finally {
        this.connections.delete(connectionId);
        this.metrics.activeConnections = Math.max(0, this.metrics.activeConnections - 1);
      }
    }
  }
  
  /**
   * Clean up stale connections
   */
  private async cleanupStaleConnections(): Promise<void> {
    const staleConnections: string[] = [];
    
    for (const [id, connection] of this.connections.entries()) {
      if (!this.isConnectionValid(connection)) {
        staleConnections.push(id);
      }
    }
    
    if (staleConnections.length > 0) {
      console.log(`[DatabasePool] Cleaning up ${staleConnections.length} stale connections`);
      
      for (const id of staleConnections) {
        await this.closeConnection(id);
      }
    }
    
    // Enforce max connections limit
    if (this.connections.size > this.maxConnections) {
      const sortedConnections = Array.from(this.connections.entries())
        .sort(([, a], [, b]) => a.lastUsed.getTime() - b.lastUsed.getTime());
      
      const toRemove = sortedConnections.slice(0, this.connections.size - this.maxConnections);
      
      for (const [id] of toRemove) {
        await this.closeConnection(id);
      }
    }
  }
  
  /**
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    for (const [id, connection] of this.connections.entries()) {
      try {
        await connection.prisma.$queryRaw`SELECT 1`;
        connection.isHealthy = true;
      } catch (error) {
        console.warn(`[DatabasePool] Health check failed for connection ${id}:`, error);
        connection.isHealthy = false;
        
        // Close unhealthy connection
        await this.closeConnection(id);
      }
    }
  }
  
  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics & { connections: number } {
    return {
      ...this.metrics,
      connections: this.connections.size,
    };
  }
  
  /**
   * Get detailed connection information
   */
  getConnectionInfo(): Array<{
    id: string;
    createdAt: Date;
    lastUsed: Date;
    useCount: number;
    age: number;
    isHealthy: boolean;
  }> {
    const now = new Date();
    
    return Array.from(this.connections.entries()).map(([id, connection]) => ({
      id,
      createdAt: connection.createdAt,
      lastUsed: connection.lastUsed,
      useCount: connection.useCount,
      age: now.getTime() - connection.createdAt.getTime(),
      isHealthy: connection.isHealthy,
    }));
  }
  
  /**
   * Execute a query with automatic connection management
   */
  async executeWithConnection<T>(
    query: (prisma: PrismaClient) => Promise<T>,
    connectionId: string = 'default'
  ): Promise<T> {
    const prisma = await this.getConnection(connectionId);
    
    try {
      return await query(prisma);
    } catch (error) {
      // Mark connection as potentially unhealthy on error
      const connection = this.connections.get(connectionId);
      if (connection && error instanceof Error && error.message.includes('connection')) {
        connection.isHealthy = false;
      }
      
      throw error;
    }
  }
  
  /**
   * Execute multiple queries in a transaction
   */
  async executeTransaction<T>(
    queries: (prisma: PrismaClient) => Promise<T>,
    connectionId: string = 'default'
  ): Promise<T> {
    const prisma = await this.getConnection(connectionId);
    
    try {
      return await prisma.$transaction(async (tx) => {
        return await queries(tx as PrismaClient);
      });
    } catch (error) {
      // Mark connection as potentially unhealthy on transaction error
      const connection = this.connections.get(connectionId);
      if (connection && error instanceof Error && error.message.includes('connection')) {
        connection.isHealthy = false;
      }
      
      throw error;
    }
  }
  
  /**
   * Gracefully shutdown all connections
   */
  async shutdown(): Promise<void> {
    console.log('[DatabasePool] Shutting down database pool...');
    
    const shutdownPromises = Array.from(this.connections.keys()).map(id => 
      this.closeConnection(id)
    );
    
    await Promise.allSettled(shutdownPromises);
    
    console.log('[DatabasePool] Database pool shutdown complete');
  }
  
  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      totalConnections: 0,
      activeConnections: this.connections.size,
      connectionErrors: 0,
      averageConnectionTime: 0,
      lastConnectionTime: null,
      lastError: null,
    };
  }
}

// Global singleton instance
const databasePool = new DatabasePool();

/**
 * Get a database connection from the pool
 */
export async function getPooledConnection(connectionId?: string): Promise<PrismaClient> {
  return databasePool.getConnection(connectionId);
}

/**
 * Execute a query with automatic connection management
 */
export async function executeWithPool<T>(
  query: (prisma: PrismaClient) => Promise<T>,
  connectionId?: string
): Promise<T> {
  return databasePool.executeWithConnection(query, connectionId);
}

/**
 * Execute multiple queries in a transaction
 */
export async function executeTransaction<T>(
  queries: (prisma: PrismaClient) => Promise<T>,
  connectionId?: string
): Promise<T> {
  return databasePool.executeTransaction(queries, connectionId);
}

/**
 * Get pool metrics for monitoring
 */
export function getPoolMetrics() {
  return databasePool.getMetrics();
}

/**
 * Get detailed connection information
 */
export function getPoolConnectionInfo() {
  return databasePool.getConnectionInfo();
}

/**
 * Close a specific connection
 */
export async function closePoolConnection(connectionId: string): Promise<void> {
  return databasePool.closeConnection(connectionId);
}

/**
 * Shutdown the entire pool (for testing or graceful shutdown)
 */
export async function shutdownPool(): Promise<void> {
  return databasePool.shutdown();
}

/**
 * Reset pool metrics (for testing)
 */
export function resetPoolMetrics(): void {
  return databasePool.resetMetrics();
}

/**
 * Health check for the database pool
 */
export async function healthCheck(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  metrics: ReturnType<typeof getPoolMetrics>;
  connections: ReturnType<typeof getPoolConnectionInfo>;
  timestamp: Date;
}> {
  const metrics = getPoolMetrics();
  const connections = getPoolConnectionInfo();
  
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  
  // Determine health status
  if (metrics.connectionErrors > 5) {
    status = 'unhealthy';
  } else if (metrics.connectionErrors > 2 || metrics.averageConnectionTime > 5000) {
    status = 'degraded';
  }
  
  // Check if we have any healthy connections
  const healthyConnections = connections.filter(c => c.isHealthy).length;
  if (healthyConnections === 0 && connections.length > 0) {
    status = 'unhealthy';
  }
  
  return {
    status,
    metrics,
    connections,
    timestamp: new Date(),
  };
}

/**
 * Middleware helper for automatic connection management
 */
export function createDatabaseMiddleware(connectionId?: string) {
  return async (event: any, context: any) => {
    const startTime = Date.now();
    
    try {
      const prisma = await getPooledConnection(connectionId);
      context.prisma = prisma;
      context.dbConnectionId = connectionId || 'default';
      
      console.log(`[DatabasePool] Connection acquired in ${Date.now() - startTime}ms`);
      
      return context;
    } catch (error) {
      console.error('[DatabasePool] Failed to acquire connection:', error);
      throw error;
    }
  };
}

export default databasePool;