# Google Maps Integration Architecture

## 🏗️ Performance-Optimized Architecture Overview

This document outlines the high-performance architecture for Google Maps integration with Dutch address support, designed for the StayCool appointment scheduling system.

## 📊 System Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Frontend App   │────▶│ Netlify Functions│────▶│  Google Maps    │
└─────────────────┘     └──────────────────┘     │     APIs        │
                               │                  └─────────────────┘
                               │                           │
                               ▼                           │
                        ┌─────────────┐                   │
                        │ Redis Cache │◀──────────────────┘
                        └─────────────┘
                               │
                               ▼
                        ┌─────────────┐
                        │  PostgreSQL  │
                        └─────────────┘
```

## 🚀 Performance Strategy

### 1. **Multi-Layer Caching Architecture**

```typescript
// Layer 1: In-Memory LRU Cache (Ultra-fast, 10MB limit)
const memoryCache = new LRUCache<string, CachedResult>({
  max: 1000, // Maximum entries
  ttl: 1000 * 60 * 5, // 5 minutes
  sizeCalculation: (value) => JSON.stringify(value).length,
  maxSize: 10 * 1024 * 1024, // 10MB
});

// Layer 2: Redis Cache (Fast, distributed, 100MB limit)
const redisCache = {
  geocoding: 'geo:', // TTL: 30 days (place IDs are permanent)
  routes: 'route:', // TTL: 1 hour (traffic-aware)
  matrix: 'matrix:', // TTL: 1 hour
};

// Layer 3: Database Cache (Persistent, unlimited)
// Store place_id, lat, lng in Customer/Lead tables
```

### 2. **Request Optimization Matrix**

| API | Batch Size | Cache TTL | Rate Limit | Priority |
|-----|------------|-----------|------------|----------|
| Geocoding | 1 | 30 days | 3000 QPM | High |
| Routes | 25 waypoints | 1 hour | 3000 QPM | Medium |
| Matrix | 25x25 | 1 hour | 3000 QPM | Low |

### 3. **Cost Optimization Through Field Masks**

```typescript
// Basic Tier ($5 CPM) - Essential fields only
const BASIC_FIELD_MASK = 'routes.duration,routes.distanceMeters';

// Advanced Tier ($10 CPM) - With traffic
const ADVANCED_FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline';

// Preferred Tier ($15 CPM) - All features
const FULL_FIELD_MASK = 'routes.*';
```

## 🛣️ API Functions Design

### 1. **Geocoding Function** (`/geocode-address`)

**Purpose**: Convert Dutch addresses to coordinates with intelligent caching

**Performance Features**:
- Component filtering for Netherlands
- Place ID permanent caching
- Address normalization
- Batch geocoding support

**Request Flow**:
1. Check memory cache (< 1ms)
2. Check Redis cache (< 5ms)
3. Check database for existing place_id (< 10ms)
4. Call Google Geocoding API (50-200ms)
5. Store in all cache layers

### 2. **Distance Calculation** (`/calculate-distance`)

**Purpose**: Calculate distances between multiple points efficiently

**Performance Features**:
- Matrix batching (up to 625 elements)
- Traffic-aware caching
- Travel mode optimization
- Concurrent request handling

**Optimization Strategy**:
```typescript
// Batch requests efficiently
const batchSize = 25;
const chunks = chunkArray(destinations, batchSize);
const results = await Promise.all(
  chunks.map(chunk => computeRouteMatrix(origin, chunk))
);
```

### 3. **Route Optimization** (`/optimize-route`)

**Purpose**: Find optimal routes for multiple appointments

**Performance Features**:
- Waypoint optimization (up to 25 points)
- Bicycle routing priority
- Real-time traffic integration
- Polyline compression

**Dutch-Specific Optimizations**:
- Default to bicycle routing
- Consider canal bridges and cycling infrastructure
- Integrate with appointment time windows

## 🔒 Security & Rate Limiting

### 1. **API Key Management**

```typescript
// Separate keys for different environments
const API_KEYS = {
  production: process.env.GOOGLE_MAPS_API_KEY_PROD,
  development: process.env.GOOGLE_MAPS_API_KEY_DEV,
  testing: process.env.GOOGLE_MAPS_API_KEY_TEST,
};

// Key rotation support
const getActiveKey = () => {
  return keyRotation.getCurrentKey();
};
```

### 2. **Rate Limiting Strategy**

```typescript
// Per-API rate limits
const rateLimits = {
  geocoding: { window: 60, limit: 50 }, // 50/minute
  routes: { window: 60, limit: 30 }, // 30/minute
  matrix: { window: 60, limit: 20 }, // 20/minute
};

// Cost-based throttling
const costThrottle = {
  dailyLimit: 1000, // $50/day max
  alertThreshold: 0.8, // Alert at 80%
};
```

### 3. **Circuit Breaker Pattern**

```typescript
const circuitBreaker = new CircuitBreaker(googleMapsCall, {
  timeout: 3000, // 3 second timeout
  errorThresholdPercentage: 50,
  resetTimeout: 30000, // 30 seconds
  volumeThreshold: 10,
});
```

## 📊 Performance Metrics

### 1. **Target SLAs**

| Metric | Target | Measurement |
|--------|--------|-------------|
| Geocoding Response | < 50ms (cached) | P95 latency |
| Route Calculation | < 200ms | P95 latency |
| Matrix Calculation | < 500ms | P95 latency |
| Cache Hit Rate | > 80% | Daily average |
| Error Rate | < 0.1% | Daily average |

### 2. **Monitoring Implementation**

```typescript
// Performance tracking
const metrics = {
  apiLatency: new Histogram({
    name: 'google_maps_api_latency',
    help: 'API call latency in ms',
    labelNames: ['api_type', 'cached'],
  }),
  
  cacheHitRate: new Gauge({
    name: 'google_maps_cache_hit_rate',
    help: 'Cache hit rate percentage',
    labelNames: ['cache_type'],
  }),
  
  apiCost: new Counter({
    name: 'google_maps_api_cost',
    help: 'Estimated API cost in cents',
    labelNames: ['api_type'],
  }),
};
```

## 🇳🇱 Dutch-Specific Optimizations

### 1. **Address Normalization**

```typescript
const normalizeAddress = (address: DutchAddress): string => {
  // Format: "Street HouseNumber Addition, PostalCode City"
  const street = `${address.street} ${address.houseNumber}${address.addition || ''}`;
  const postalCode = address.postalCode.replace(/\s/g, ' ').toUpperCase();
  return `${street}, ${postalCode} ${address.city}, Netherlands`;
};
```

### 2. **Bicycle Routing Priority**

```typescript
const routePreferences = {
  travelMode: 'BICYCLE', // Default for Netherlands
  avoidTolls: true,
  avoidHighways: true, // For bicycle routes
  optimizeWaypoints: true,
  alternativeRoutes: true,
};
```

### 3. **Regional Clustering**

```typescript
// Group appointments by Dutch provinces
const clusterByRegion = (appointments: Appointment[]) => {
  const clusters = {
    'Noord-Holland': [],
    'Zuid-Holland': [],
    'Utrecht': [],
    // ... other provinces
  };
  
  // Use postal code prefix for clustering
  appointments.forEach(apt => {
    const region = getRegionFromPostalCode(apt.postalCode);
    clusters[region].push(apt);
  });
  
  return clusters;
};
```

## 🔄 Migration Path

### Phase 1: Basic Implementation (Week 1)
- Geocoding with caching
- Basic distance calculation
- Simple route computation

### Phase 2: Performance Optimization (Week 2)
- Redis integration
- Batch processing
- Advanced caching strategies

### Phase 3: Advanced Features (Week 3)
- Route optimization
- Traffic integration
- Performance monitoring

### Phase 4: Production Hardening (Week 4)
- Circuit breakers
- Cost monitoring
- Alert systems

## 💰 Cost Projections

### Monthly Estimates (1000 appointments/day)

| Feature | Requests/Day | Cache Hit Rate | Billable Calls | Monthly Cost |
|---------|--------------|----------------|----------------|--------------|
| Geocoding | 1000 | 80% | 200 | $30 |
| Routes | 500 | 60% | 200 | $40 |
| Matrix | 100 | 70% | 30 | $9 |
| **Total** | | | **430/day** | **$79/month** |

### Cost Optimization Strategies

1. **Aggressive Caching**: Store results for 30+ days where possible
2. **Batch Processing**: Group similar requests
3. **Off-Peak Processing**: Schedule non-urgent calculations
4. **Field Mask Optimization**: Only request necessary data
5. **Regional Clustering**: Reduce redundant calculations

## 🚨 Error Recovery Strategies

### 1. **Graceful Degradation**

```typescript
const getRouteWithFallback = async (origin, destination) => {
  try {
    // Try Routes API first
    return await routesAPI.compute(origin, destination);
  } catch (error) {
    // Fallback to straight-line distance
    return calculateHaversineDistance(origin, destination);
  }
};
```

### 2. **Retry Logic**

```typescript
const retryWithBackoff = async (fn, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000); // Exponential backoff
    }
  }
};
```

This architecture provides a robust, performant foundation for Google Maps integration with specific optimizations for the Dutch market and appointment scheduling use case.