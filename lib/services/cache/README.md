# Redis Caching Layer Documentation

## Overview

This caching layer provides a comprehensive, high-performance caching solution for the StayCool appointment booking system. It implements multi-layer caching (L1 memory + L2 Redis) with intelligent cache warming, real-time invalidation, and performance monitoring.

## Architecture

### Core Components

1. **Redis Cache Service** (`redis-cache.service.ts`)
   - Multi-layer caching (LRU memory cache + Redis)
   - Compression for values > 1KB
   - Performance metrics tracking
   - Namespace-based configuration

2. **Geocoding Cache** (`geocoding-cache.ts`)
   - 30-day TTL for geocoding results
   - Place ID permanent caching
   - Frequent address tracking
   - Postal code area caching

3. **Availability Cache** (`availability-cache.ts`)
   - 3-hour TTL for time slots
   - Real-time slot booking updates
   - Calendar event integration
   - Invalidation queue for batch processing

4. **Route Cache** (`route-cache.ts`)
   - 24-hour TTL for standard routes
   - 7-day TTL for distance matrices
   - Traffic-aware route caching (1-hour TTL)
   - Service area optimization

5. **Cache Manager** (`cache-manager.ts`)
   - Unified interface for all caches
   - Scheduled warming tasks
   - Health monitoring
   - Performance statistics

6. **Cache Hooks** (`cache-hooks.ts`)
   - Automatic invalidation on data changes
   - Prisma middleware integration
   - Pre-warming for new data

## Setup and Configuration

### Environment Variables

```bash
# Redis connection
REDIS_URL=redis://localhost:6379

# Optional: Redis credentials
REDIS_PASSWORD=your-password
REDIS_USERNAME=default

# Cache configuration
CACHE_MAX_MEMORY_MB=50
CACHE_WARMING_ENABLED=true
```

### Initialization

```typescript
import { cacheManager } from '@/lib/services/cache/cache-manager';

// Initialize cache system
await cacheManager.initialize(process.env.REDIS_URL);
```

### Prisma Integration

```typescript
import { PrismaClient } from '@prisma/client';
import { setupPrismaMiddleware } from '@/lib/services/cache/cache-hooks';

const prisma = new PrismaClient();
setupPrismaMiddleware(prisma);
```

## Usage Examples

### Geocoding Cache

```typescript
import { cacheManager } from '@/lib/services/cache/cache-manager';
import { DutchAddress } from '@/types/google-maps';

// Check cache for geocoding result
const address: DutchAddress = {
  street: 'Kruisweg',
  houseNumber: '1126',
  postalCode: '2131 GV',
  city: 'Hoofddorp'
};

const cached = await cacheManager.getGeocodingResult(address);
if (!cached) {
  // Perform geocoding
  const result = await googleMaps.geocodeAddress(address);
  // Cache the result
  await cacheManager.setGeocodingResult(address, result);
}
```

### Availability Cache

```typescript
// Get available slots for a date
const date = new Date('2024-01-15');
const slots = await cacheManager.getAvailableSlots(date);

if (!slots) {
  // Calculate availability
  const calculatedSlots = await calculateAvailability(date);
  // Cache the results
  await cacheManager.setAvailableSlots(date, calculatedSlots);
}

// Real-time updates when booking
await cacheManager.markSlotBooked(date, '10:00');

// Invalidate when appointments change
await cacheManager.invalidateAvailability(date);
```

### Route Cache

```typescript
// Cache a route calculation
const origin = { lat: 52.3676, lng: 4.9041 };
const destination = { lat: 52.3025, lng: 4.6889 };

const cachedRoute = await cacheManager.getRoute(
  origin,
  destination,
  TravelMode.DRIVING
);

if (!cachedRoute) {
  const route = await googleMaps.calculateRoute({
    origin,
    destination,
    travelMode: TravelMode.DRIVING
  });
  await cacheManager.setRoute(origin, destination, route);
}
```

## Cache Keys Structure

### Geocoding
- Address: `geo:addr:{hash}`
- Place ID: `geo:place:{placeId}`
- Postal Code: `geo:postal:{postalCode}`
- City: `geo:city:{city}`
- Frequent: `geo:frequent:addresses`

### Availability
- Date Slots: `avail:slots:{yyyy-MM-dd}`
- Date Range: `avail:range:{start}:{end}`
- Blocked Dates: `avail:blocked:dates`
- Calendar Events: `avail:calendar:{yyyy-MM-dd}`
- Slot Bookings: `avail:bookings:{date}:{time}`

### Routes
- Standard Route: `route:{mode}:{originHash}:{destHash}`
- Optimized Route: `route:optimized:{mode}:{routeHash}`
- Distance Matrix: `route:matrix:{mode}:{matrixHash}`
- Route Cluster: `route:cluster:{clusterId}`
- Service Area: `route:service:{area}:{date}`

## Cache Warming Strategies

### Scheduled Warming
- Every 4 hours: Full cache warming
- 8 AM & 6 PM: Peak time warming
- 6 AM: Availability warming for the day

### Intelligent Warming
1. **Geocoding**
   - Upcoming appointment addresses (7 days)
   - Frequently used addresses
   - Recent lead addresses
   - Postal code centroids

2. **Availability**
   - Next 30 days of availability
   - Popular time slots
   - Common date ranges (7, 14, 30 days)

3. **Routes**
   - Frequent routes
   - Service area routes
   - Upcoming appointment routes
   - Popular area distance matrices

## Performance Monitoring

### Access Monitoring Endpoint

```bash
# Get cache statistics
curl https://your-domain/.netlify/functions/cache-monitor?action=stats

# Get health status
curl https://your-domain/.netlify/functions/cache-monitor?action=health

# Admin operations (requires admin token)
curl -X POST https://your-domain/.netlify/functions/cache-monitor \
  -H "Content-Type: application/json" \
  -d '{
    "action": "warm",
    "target": "all",
    "adminToken": "your-admin-jwt"
  }'
```

### Key Metrics
- **Hit Rate**: Target > 70%
- **Average Latency**: < 50ms for cache hits
- **Memory Usage**: Monitor L1 cache size
- **Redis Keys**: Track total key count

## Best Practices

### 1. Always Check Cache First
```typescript
// Good
const cached = await cacheManager.getRoute(origin, dest);
if (!cached) {
  const route = await calculateRoute(origin, dest);
  await cacheManager.setRoute(origin, dest, route);
}

// Bad
const route = await calculateRoute(origin, dest);
```

### 2. Use Batch Operations
```typescript
// Good - single batch operation
const results = await geocodingCache.batchGet(addresses);

// Bad - multiple individual calls
for (const address of addresses) {
  const result = await geocodingCache.get(address);
}
```

### 3. Implement Proper Error Handling
```typescript
try {
  const cached = await cacheManager.getAvailableSlots(date);
  if (!cached) {
    // Fallback to calculation
  }
} catch (error) {
  console.error('Cache error:', error);
  // Continue with direct calculation
}
```

### 4. Use Appropriate TTLs
- Geocoding: 30 days (addresses don't change often)
- Availability: 3 hours (changes frequently)
- Routes: 24 hours (traffic patterns)
- Traffic-aware routes: 1 hour

### 5. Monitor Performance
```typescript
const stats = await cacheManager.getStats();
if (stats.performance.hitRate < 70) {
  // Consider warming more data
}
```

## Troubleshooting

### Low Hit Rate
1. Check warming tasks are running
2. Verify Redis connection is stable
3. Review TTL settings
4. Check invalidation patterns

### High Memory Usage
1. Reduce L1 cache size
2. Adjust compression threshold
3. Review cached data size
4. Implement more aggressive eviction

### Redis Connection Issues
1. Check REDIS_URL configuration
2. Verify network connectivity
3. Check Redis server status
4. Review connection pool settings

### Cache Inconsistency
1. Verify invalidation hooks are working
2. Check Prisma middleware setup
3. Review real-time update mechanisms
4. Monitor invalidation queue size

## Performance Benchmarks

### Expected Performance
- **Cache Hit Latency**: 1-5ms
- **Cache Miss + API Call**: 100-500ms
- **Compression Overhead**: 5-10ms for large values
- **Batch Operations**: 10-50ms for 100 items

### Memory Usage
- **L1 Cache**: Max 50MB
- **Redis Memory**: Depends on data volume
- **Compression Savings**: 30-70% for large responses

## Future Enhancements

1. **Distributed Cache Invalidation**
   - Redis Pub/Sub for multi-instance deployments
   - WebSocket notifications for real-time updates

2. **Machine Learning Integration**
   - Predictive cache warming
   - Usage pattern analysis
   - Optimal TTL determination

3. **Advanced Monitoring**
   - Grafana dashboards
   - Alerting on performance degradation
   - Cost tracking and optimization

4. **Edge Caching**
   - CDN integration for static data
   - Geographic distribution
   - Reduced latency for global users