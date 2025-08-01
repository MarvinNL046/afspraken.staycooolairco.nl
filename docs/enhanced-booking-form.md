# Enhanced Booking Form - StayCool Airco

## Overview

The Enhanced Booking Form is a sophisticated multi-step appointment booking system that integrates location-based availability checking, Google Maps services, and intelligent route optimization to provide an optimal user experience for customers booking airconditioning services in Limburg, Netherlands.

## Features

### 🎯 Multi-Step Process
1. **Service Selection** - Choose from installation, maintenance, repair, or inspection
2. **Address Input** - Google Places autocomplete with service area validation
3. **Date & Time Selection** - Real-time availability based on location and existing appointments
4. **Customer Details** - Contact information with validation
5. **Review & Confirm** - Final confirmation with booking submission

### 🗺️ Location Intelligence
- **Service Area Validation**: Automatically validates addresses within Limburg province (postal codes 5800-6999)
- **Google Places Integration**: Autocomplete with precise geocoding
- **Route Optimization**: Real-time availability calculation based on travel time between appointments
- **Cluster Visualization**: Interactive map showing existing appointments and optimal routing

### 📅 Smart Scheduling
- **Location-Based Availability**: Calculates available time slots based on customer location relative to existing appointments
- **Travel Time Consideration**: Accounts for driving time between appointments (15-20 minutes buffer)
- **Efficiency Scoring**: Rates time slots based on route efficiency
- **Business Rules**: 
  - Max 5 appointments per day
  - Working hours: 9:30-16:00 (Monday-Friday)
  - 20km radius service constraint

### 🎨 User Experience
- **Progress Indicator**: Clear visual progress through booking steps
- **Real-time Validation**: Instant feedback on address and availability
- **Mobile Responsive**: Optimized for all device sizes
- **Loading States**: Smooth transitions and loading indicators
- **Error Handling**: Comprehensive error handling with user-friendly messages

## Technical Architecture

### Core Components

#### Multi-Step Form Framework
```typescript
// components/booking/multi-step-form.tsx
- BookingFormProvider: Context-based state management
- StepIndicator: Visual progress tracking
- FormNavigation: Navigation between steps
```

#### Step Components
```typescript
// components/booking/steps/
- service-selection.tsx: Service type selection
- address-input.tsx: Google Places autocomplete
- date-time-selection.tsx: Availability calendar
- customer-details.tsx: Contact information
- review-confirm.tsx: Final confirmation
```

#### Map Visualization
```typescript
// components/booking/cluster-map.tsx
- Interactive Google Maps integration
- Appointment clustering visualization
- Route path display
```

### Integration Points

#### Google Services API Integration
- **Places API**: Address autocomplete and geocoding
- **Maps JavaScript API**: Interactive map visualization
- **Geocoding API**: Address validation and coordinates

#### Calendar Integration
- **Google Calendar API**: Fetches existing appointments
- **Color Filtering**: Only processes yellow (ID: 5) appointments for sales team
- **Real-time Sync**: Live availability checking

#### Route Optimization
- **Netlify Functions**: 
  - `optimize-daily-routes.ts`: Location-based availability calculation
  - `cluster-routes.ts`: Intelligent route clustering
- **Distance Matrix**: Travel time calculations
- **Efficiency Scoring**: Route optimization algorithms

### Database Schema

#### Service Areas
```sql
service_areas:
- id, name, province, is_active
- calendar_color_id (5 for yellow/sales team)
- sales_person_id, sales_person_name

postal_code_ranges:
- service_area_id, start_code (5800), end_code (6999)
```

#### Location Data
```sql
customers/leads:
- latitude, longitude, place_id
- geocoded_at, geocode_accuracy
```

## Setup Instructions

### 1. Dependencies Installation
```bash
npm install react-day-picker @react-google-maps/api
```

### 2. Environment Configuration
Add to `.env`:
```env
# Google Maps API (client-side)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-public-google-maps-api-key

# Google Maps API (server-side)
GOOGLE_MAPS_API_KEY=your-server-google-maps-api-key
```

Enable these APIs in Google Cloud Console:
- Maps JavaScript API
- Places API
- Geocoding API
- Directions API

### 3. Database Setup
```bash
# Generate and push schema
npx prisma generate
npx prisma db push

# Setup service area
node scripts/setup-service-area.js
```

### 4. Verification
```bash
# Run integration test
node scripts/test-enhanced-booking.js
```

## Usage

### Access the Enhanced Form
Navigate to: `/booking-enhanced`

### Form Flow
1. **Service Selection**: Customer selects service type and adds description
2. **Address Input**: 
   - Customer starts typing address
   - Google Places provides autocomplete suggestions
   - System validates address is in Limburg
   - Coordinates are automatically captured
3. **Date/Time Selection**:
   - Customer selects preferred date
   - System calculates available time slots based on location
   - Map visualization shows existing appointments and route efficiency
   - Recommended slots are highlighted
4. **Customer Details**: Contact information with validation
5. **Review & Confirm**: Final review before submission

### Backend Processing
1. **Address Validation**: Postal code range check (5800-6999)
2. **Availability Calculation**: 
   - Fetch existing appointments (yellow/ID:5 only)
   - Calculate travel times between locations
   - Generate optimal time slots
3. **Route Optimization**: Consider existing daily appointments and travel efficiency
4. **Calendar Integration**: Create Google Calendar event with location data
5. **Database Storage**: Store appointment with geocoded location

## API Endpoints

### Availability Checking
```
POST /.netlify/functions/optimize-daily-routes
{
  "date": "2024-01-15",
  "customerLocation": {
    "lat": 50.8514,
    "lng": 5.6909
  },
  "serviceType": "installation"
}
```

Returns available time slots with efficiency ratings and route information.

### Route Clustering
```
POST /.netlify/functions/cluster-routes
{
  "startDate": "2024-01-15",
  "endDate": "2024-01-19",
  "optimizationStrategy": "balanced"
}
```

Returns optimized daily route clusters for the date range.

## Configuration

### Business Rules
```typescript
const BUSINESS_HOURS = {
  start: '09:30',
  end: '16:00',
  appointmentDuration: 60, // minutes
  maxAppointmentsPerDay: 5,
  maxRadiusKm: 20,
  workDays: [1, 2, 3, 4, 5], // Monday to Friday
  bufferTimeMinutes: 15
}
```

### Service Area
- **Province**: Limburg, Netherlands
- **Postal Codes**: 5800-6999
- **Major Cities**: Maastricht, Heerlen, Sittard-Geleen, Venlo, Roermond, Weert
- **Calendar Color**: Yellow (ID: 5) for sales team filtering

## Troubleshooting

### Common Issues

#### Google Maps Not Loading
- Verify `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set
- Check API key has required permissions
- Ensure billing is activated in Google Cloud

#### Address Validation Failing
- Check postal code is in range 5800-6999
- Verify Geocoding API is enabled
- Test with known Limburg addresses

#### No Available Slots
- Check existing appointments in Google Calendar
- Verify appointments have yellow color (ID: 5)
- Ensure dates are business days (Mon-Fri)

#### Route Optimization Errors
- Verify customer location has valid coordinates
- Check Google Calendar API connectivity
- Review console logs for detailed error messages

### Debug Commands
```bash
# Test database integration
node scripts/test-enhanced-booking.js

# Setup/verify service area
node scripts/setup-service-area.js

# Check Prisma schema sync
npx prisma db pull
npx prisma generate
```

## Performance Considerations

### Optimization Features
- **Caching**: Redis-based caching for API responses
- **Parallel Processing**: Concurrent API calls where possible
- **Smart Loading**: Progressive loading of map components
- **Debounced Input**: Address input debouncing to reduce API calls

### Monitoring
- Route optimization performance metrics
- Google Maps API usage tracking
- Appointment booking success rates
- User experience analytics

## Future Enhancements

### Potential Improvements
- **Multi-Service Area**: Support for additional provinces
- **Advanced Routing**: Machine learning-based route optimization
- **Customer Preferences**: Time slot preferences and recurring appointments
- **Mobile App**: Native mobile application
- **SMS Integration**: SMS confirmation and reminders
- **Payment Integration**: Online payment processing

### Scalability Considerations
- Database partitioning for high-volume usage
- CDN integration for map assets
- Load balancing for API endpoints
- Microservices architecture for larger deployments

## Support

For technical support or questions about the Enhanced Booking Form:
- Check console logs for detailed error information
- Review API response codes and messages
- Test individual components using provided scripts
- Verify environment configuration and API keys

The Enhanced Booking Form represents a significant advancement in appointment scheduling technology, providing both customers and service providers with an intelligent, efficient, and user-friendly booking experience.