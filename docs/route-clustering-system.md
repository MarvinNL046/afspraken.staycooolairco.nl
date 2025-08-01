# Intelligent Route Clustering System

## Overview

The Intelligent Route Clustering System is a performance-optimized solution for automatically organizing service appointments into efficient daily routes. It considers multiple constraints including working hours, geographic boundaries, and driving time to maximize technician productivity.

## Key Features

### 1. **Time Window Constraints**
- Working hours: Monday-Friday, 9:30 AM - 4:00 PM
- Maximum 5 appointments per day
- 1-hour appointment duration
- 15-minute buffer between appointments
- Automatic driving time calculation

### 2. **Geographic Constraints**
- 20km radius from central point
- Efficient clustering algorithm
- Traffic-aware route optimization
- Support for multiple travel modes (driving, cycling)

### 3. **Performance Optimization**
- Multi-layer caching (Memory + Redis)
- Batch processing capabilities
- Real-time route optimization
- Efficiency scoring (0-100%)

### 4. **Intelligent Scheduling**
- Priority-based appointment assignment
- Automatic workload balancing
- Alternative route suggestions
- Cost analysis (fuel + time)

## API Endpoints

### 1. Cluster Routes
```
POST /.netlify/functions/cluster-routes

Request:
{
  "startDate": "2024-01-15",
  "endDate": "2024-01-19",
  "centerPoint": {
    "lat": 52.3676,
    "lng": 4.9041
  },
  "travelMode": "DRIVING",
  "optimizationStrategy": "balanced",
  "apiKey": "your-admin-api-key"
}

Response:
{
  "success": true,
  "result": {
    "clusters": [
      {
        "date": "2024-01-15",
        "appointments": [...],
        "totalTravelTime": 87,
        "totalDistance": 42500,
        "efficiency": 82,
        "timeline": [...]
      }
    ],
    "unassignedAppointments": [],
    "summary": {
      "totalAppointments": 23,
      "assignedAppointments": 21,
      "totalDays": 5,
      "averageEfficiency": 79,
      "totalTravelDistance": 215000,
      "totalTravelTime": 435
    }
  }
}
```

### 2. Analyze Route Efficiency
```
POST /.netlify/functions/analyze-route-efficiency

Request:
{
  "routeClusterId": "cluster-id",
  "date": "2024-01-15",
  "travelMode": "DRIVING",
  "includeRecommendations": true,
  "apiKey": "your-admin-api-key"
}

Response:
{
  "success": true,
  "analyses": [
    {
      "clusterId": "cluster-id",
      "date": "2024-01-15",
      "metrics": {
        "appointments": 5,
        "totalDistance": 42500,
        "totalDuration": 87,
        "workingTime": 387,
        "efficiency": 77,
        "utilizationRate": 99
      },
      "timeline": [...],
      "costs": {
        "fuel": 8.50,
        "time": 290.25,
        "total": 298.75
      },
      "recommendations": [
        "Route-efficiëntie kan verbeterd worden door..."
      ]
    }
  ]
}
```

## Configuration

### Business Rules
```javascript
const BUSINESS_HOURS = {
  start: '09:30',
  end: '16:00',
  appointmentDuration: 60, // minutes
  maxAppointmentsPerDay: 5,
  maxRadiusKm: 20,
  workDays: [1, 2, 3, 4, 5], // Monday to Friday
  bufferTimeMinutes: 15
};
```

### Optimization Strategies

1. **Balanced** (default)
   - Balances travel distance and appointment priority
   - Best for mixed urban/suburban areas

2. **Minimal Travel**
   - Prioritizes geographic clustering
   - Best for dense urban areas

3. **Maximum Appointments**
   - Prioritizes fitting maximum appointments
   - Best when appointment volume is critical

## Algorithm Details

### Clustering Algorithm

1. **Initial Filtering**
   - Filter appointments within 20km radius
   - Check date availability
   - Verify geocoding data

2. **Intelligent Assignment**
   - Sort by priority and proximity
   - Attempt preferred date assignment
   - Find alternative dates if needed
   - Track unassigned appointments

3. **Route Optimization**
   - Use Google Maps for accurate routing
   - Apply waypoint optimization
   - Calculate actual travel times
   - Build detailed timeline

4. **Efficiency Calculation**
   ```
   Efficiency = (Utilization × 0.3) + (AppointmentRatio × 0.4) + (TravelEfficiency × 0.3)
   ```

### Performance Optimizations

1. **Caching Strategy**
   - Cache travel time calculations (1 hour TTL)
   - Cache route optimizations (6 hours TTL)
   - Use Redis for distributed caching

2. **Batch Processing**
   - Process routes in parallel batches
   - Limit concurrent API calls
   - Implement retry logic

3. **Fallback Mechanisms**
   - Nearest-neighbor algorithm
   - Haversine distance estimation
   - Traffic pattern estimates

## Database Schema

### RouteCluster Model
```prisma
model RouteCluster {
  id                String      @id @default(uuid())
  datum             DateTime    @db.Date
  regio             String      
  naam              String?     
  notities          String?
  
  // Route optimization fields
  optimizedOrder    Json?       // Array of appointment IDs
  totalDistance     Float?      // Total distance in meters
  totalDuration     Int?        // Total duration in minutes
  routePolyline     String?     // Encoded polyline
  travelMode        String      @default("DRIVING")
  optimizedAt       DateTime?   
  
  afspraken         Afspraak[]
}
```

### Afspraak (Appointment) Updates
```prisma
model Afspraak {
  // ... existing fields ...
  routeClusterId   String?     @map("route_cluster_id")
  prioriteit       Int         @default(0) // 0=normal, 1=high, 2=urgent
  
  routeCluster     RouteCluster? @relation(...)
}
```

## Cost Analysis

### Cost Factors
- **Fuel Cost**: €0.20/km for driving
- **Time Cost**: €45/hour technician rate
- **Total Cost**: Fuel + Time costs

### Example Calculation
```
Route: 42.5km, 387 minutes working time
Fuel: 42.5 × 0.20 = €8.50
Time: 387/60 × 45 = €290.25
Total: €298.75
```

## Best Practices

### 1. **Data Preparation**
- Ensure all appointments have geocoded addresses
- Set appropriate priorities for urgent appointments
- Verify working hours match business requirements

### 2. **Optimization Timing**
- Run clustering at end of day for next week
- Re-optimize if >20% appointments change
- Monitor efficiency scores regularly

### 3. **Performance Monitoring**
- Track average efficiency (target: >75%)
- Monitor unassigned appointment rate
- Review cost per appointment trends

### 4. **Error Handling**
- Always check for unassigned appointments
- Review recommendations for low-efficiency routes
- Have fallback plans for optimization failures

## Troubleshooting

### Common Issues

1. **High Unassigned Rate**
   - Check radius constraints
   - Verify appointment density
   - Consider adjusting working hours

2. **Low Efficiency Scores**
   - Review geographic distribution
   - Check for outlier appointments
   - Consider different optimization strategy

3. **API Rate Limits**
   - Implement request throttling
   - Use caching effectively
   - Consider batch operations

## Future Enhancements

1. **Multi-Technician Support**
   - Assign routes to multiple technicians
   - Balance workload across team
   - Consider technician skills/preferences

2. **Dynamic Rescheduling**
   - Real-time route adjustments
   - Handle cancellations/additions
   - Traffic-aware updates

3. **Advanced Analytics**
   - Historical performance tracking
   - Predictive optimization
   - Seasonal pattern analysis

4. **Mobile Integration**
   - Real-time route updates
   - Navigation integration
   - Status tracking

## Environment Variables

```env
# Google Maps API
GOOGLE_MAPS_API_KEY=your-google-maps-api-key

# Redis Cache
REDIS_URL=redis://localhost:6379

# Admin Security
ADMIN_API_KEY=your-secure-admin-key

# JWT Secret
JWT_SECRET=your-jwt-secret
```

## Migration Guide

To add the priority field to existing appointments:

```sql
-- Add prioriteit column with default value
ALTER TABLE afspraken 
ADD COLUMN prioriteit INTEGER DEFAULT 0;

-- Create index for performance
CREATE INDEX idx_afspraken_prioriteit 
ON afspraken(prioriteit);
```

Or using Prisma:
```bash
npx prisma migrate dev --name add-appointment-priority
```

## Performance Metrics

### Target KPIs
- Route Efficiency: >75%
- Daily Utilization: 80-95%
- Assignment Rate: >90%
- Average Travel Time: <20% of working time
- Cost per Appointment: <€60

### Monitoring
- Cache Hit Rate: >80%
- API Response Time: <500ms
- Optimization Time: <2s per route
- Error Rate: <1%