# Cache Integration Guide

## Quick Start

### 1. Update Environment Variables

Add to your `.env.local`:
```bash
REDIS_URL=redis://localhost:6379
```

### 2. Initialize Cache on App Start

Update your main application file:

```typescript
// app/layout.tsx or your main entry point
import { cacheManager } from '@/lib/services/cache/cache-manager';

// Initialize cache system
if (process.env.NODE_ENV === 'production') {
  cacheManager.initialize().catch(console.error);
}
```

### 3. Update Existing Services

#### Google Maps Service
Replace `google-maps.ts` imports with cached version:

```typescript
// Before
import { googleMaps } from '@/lib/google-maps';

// After
import { googleMapsCached as googleMaps } from '@/lib/services/google-maps-cached';
```

#### Availability Service
Update `availability.ts` to use cache:

```typescript
import { availabilityCache } from '@/lib/services/cache/availability-cache';

export async function getAvailableSlots(date: Date): Promise<TimeSlotWithAvailability[]> {
  // Check cache first
  const cached = await availabilityCache.getAvailableSlots(date);
  if (cached) return cached;

  // Your existing calculation logic...
  const slots = await calculateSlots(date);
  
  // Cache the results
  await availabilityCache.setAvailableSlots(date, slots);
  
  return slots;
}
```

### 4. Add Cache Hooks to Prisma

Update your Prisma client initialization:

```typescript
// lib/prisma.ts
import { PrismaClient } from '@prisma/client';
import { setupPrismaMiddleware } from '@/lib/services/cache/cache-hooks';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Add cache invalidation middleware
setupPrismaMiddleware(prisma);
```

### 5. Update API Endpoints

#### Create Appointment Endpoint
```typescript
// app/api/appointments/create/route.ts
import { CacheHooks } from '@/lib/services/cache/cache-hooks';

export async function POST(request: Request) {
  // ... create appointment logic ...
  
  const appointment = await prisma.afspraak.create({
    data: appointmentData
  });
  
  // Trigger cache updates
  await CacheHooks.onAppointmentCreated(appointment.id);
  
  return NextResponse.json(appointment);
}
```

#### Update Appointment Endpoint
```typescript
// app/api/appointments/[id]/route.ts
import { CacheHooks } from '@/lib/services/cache/cache-hooks';

export async function PATCH(request: Request, { params }) {
  const oldData = await prisma.afspraak.findUnique({
    where: { id: params.id }
  });
  
  const updated = await prisma.afspraak.update({
    where: { id: params.id },
    data: updateData
  });
  
  // Trigger cache updates
  await CacheHooks.onAppointmentUpdated(params.id, oldData, updated);
  
  return NextResponse.json(updated);
}
```

### 6. Add Monitoring Dashboard (Optional)

Create a monitoring page for admins:

```typescript
// app/admin/cache/page.tsx
'use client';

import { useEffect, useState } from 'react';

export default function CacheMonitor() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch('/.netlify/functions/cache-monitor?action=stats');
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch cache stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFlush = async (target: string) => {
    if (!confirm(`Are you sure you want to flush ${target} cache?`)) return;
    
    try {
      const res = await fetch('/.netlify/functions/cache-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'flush',
          target,
          adminToken: 'your-admin-token' // Get from secure storage
        })
      });
      
      if (res.ok) {
        alert(`${target} cache flushed successfully`);
        fetchStats();
      }
    } catch (error) {
      console.error('Failed to flush cache:', error);
    }
  };

  if (loading) return <div>Loading cache statistics...</div>;
  if (!stats) return <div>Failed to load cache statistics</div>;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Cache Monitor</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-2">Overall Performance</h2>
          <p>Hit Rate: {stats.summary.overall.hitRate}</p>
          <p>Total Hits: {stats.summary.overall.totalHits}</p>
          <p>Total Misses: {stats.summary.overall.totalMisses}</p>
          <p>Memory Usage: {stats.summary.overall.memoryUsage}</p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-2">Geocoding Cache</h2>
          <p>Cached Addresses: {stats.services.geocoding.totalCached}</p>
          <p>Frequent Addresses: {stats.services.geocoding.frequentAddresses}</p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-2">Availability Cache</h2>
          <p>Days Cached: {stats.services.availability.upcomingDaysCached}</p>
          <p>Queue Size: {stats.services.availability.invalidationQueueSize}</p>
        </div>
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-lg font-semibold mb-4">Actions</h2>
        <div className="space-x-4">
          <button 
            onClick={() => handleFlush('all')}
            className="bg-red-500 text-white px-4 py-2 rounded"
          >
            Flush All Caches
          </button>
          <button 
            onClick={() => handleFlush('geocoding')}
            className="bg-orange-500 text-white px-4 py-2 rounded"
          >
            Flush Geocoding
          </button>
          <button 
            onClick={() => handleFlush('availability')}
            className="bg-orange-500 text-white px-4 py-2 rounded"
          >
            Flush Availability
          </button>
          <button 
            onClick={() => handleFlush('routes')}
            className="bg-orange-500 text-white px-4 py-2 rounded"
          >
            Flush Routes
          </button>
        </div>
      </div>
    </div>
  );
}
```

## Testing the Integration

### 1. Verify Redis Connection
```bash
# Check Redis is running
redis-cli ping
# Should return: PONG
```

### 2. Test Cache Operations
```typescript
// Create a test file: test-cache.ts
import { cacheManager } from '@/lib/services/cache/cache-manager';

async function testCache() {
  // Initialize
  await cacheManager.initialize();
  
  // Test geocoding cache
  const address = {
    street: 'Kruisweg',
    houseNumber: '1126',
    postalCode: '2131 GV',
    city: 'Hoofddorp'
  };
  
  console.log('Setting geocoding result...');
  await cacheManager.setGeocodingResult(address, {
    latitude: 52.3025,
    longitude: 4.6889,
    placeId: 'test-place-id',
    formattedAddress: 'Kruisweg 1126, 2131 GV Hoofddorp'
  });
  
  console.log('Getting geocoding result...');
  const cached = await cacheManager.getGeocodingResult(address);
  console.log('Cached result:', cached);
  
  // Get stats
  const stats = await cacheManager.getStats();
  console.log('Cache stats:', stats);
}

testCache().catch(console.error);
```

### 3. Monitor Performance
```bash
# Watch cache statistics
curl https://your-domain/.netlify/functions/cache-monitor?action=stats | jq

# Check health
curl https://your-domain/.netlify/functions/cache-monitor?action=health | jq
```

## Deployment Checklist

- [ ] Redis instance provisioned (e.g., Redis Cloud, AWS ElastiCache)
- [ ] REDIS_URL configured in production environment
- [ ] Cache initialization added to app startup
- [ ] Prisma middleware configured
- [ ] API endpoints updated with cache hooks
- [ ] Monitoring endpoint secured with admin authentication
- [ ] Performance baselines established
- [ ] Alerting configured for cache failures

## Performance Expectations

After implementation, you should see:
- **70-90% cache hit rate** for geocoding
- **50-70% cache hit rate** for availability
- **60-80% cache hit rate** for routes
- **50-80% reduction** in Google Maps API calls
- **<50ms average latency** for cached responses
- **30-50% cost reduction** in API usage