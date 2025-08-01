# Service Area Boundary Validation System

## Overview

This system implements geographic boundary validation for appointment scheduling, limiting service areas to specific provinces in the Netherlands. Currently configured for Limburg province with Google Calendar color integration.

## Architecture

### Hybrid Validation Approach

The system uses a multi-layer validation strategy for optimal performance and accuracy:

```
1. Quick Postal Code Check (Database) - ~1ms
   ↓
2. Detailed Geocoding Validation (Google Maps API) - ~100-200ms
   ↓
3. Calendar Integration with Service Area Colors
```

## Components

### 1. Database Schema

#### Service Areas Table
- Stores service area definitions (provinces)
- Links to Google Calendar color IDs
- Associates with salesperson assignments

#### Postal Code Ranges
- Defines valid postal code ranges per service area
- Limburg: 5800-6999 (primary range)
- Supports excluded codes for edge cases

#### Validation Cache
- Caches validated addresses for 30 days
- Reduces API calls and improves performance

### 2. Boundary Validator Service (`lib/boundary-validator.ts`)

Core service providing:
- **validateAddress()**: Full address validation with confidence scoring
- **batchValidateAddresses()**: Bulk validation support
- **isLikelyLimburgPostalCode()**: Quick postal code check

Validation Methods:
- **Postal Code**: 85% confidence, database lookup
- **Geocoding**: 100% confidence, Google Maps API
- **Cache**: Previous validation results

### 3. API Endpoints

#### Check Service Boundary (`/check-service-boundary`)

**GET** - Quick postal code check:
```bash
GET /check-service-boundary?postalCode=6200AB
```

**POST** - Detailed address validation:
```json
POST /check-service-boundary
{
  "street": "Markt",
  "houseNumber": "1",
  "postalCode": "6211CK",
  "city": "Maastricht"
}
```

Response includes:
- Validation result (in/out of service area)
- Confidence score (0-100)
- Service area details
- Google Calendar color ID

### 4. Integration Points

#### Create Appointment Function
- Validates customer address before appointment creation
- Assigns Google Calendar color based on service area
- Returns detailed error for out-of-bounds addresses

#### Google Calendar Integration
- Uses color ID from service area (Yellow/5 for Limburg)
- Fallback to service type colors if not specified
- Visual differentiation for sales territories

## Limburg Province Coverage

### Primary Postal Code Ranges:
- 5800-5999: Venlo region
- 6000-6099: Weert region
- 6100-6199: Echt, Sittard region
- 6200-6299: Maastricht region
- 6300-6399: Valkenburg region
- 6400-6499: Heerlen region
- 6700-6999: Southern/Eastern Limburg

### Edge Cases:
- Some 6500-6599 codes overlap with Gelderland
- Some 6800-6899 codes overlap with Gelderland
- Validation uses Google Maps API for accurate province determination

## Performance Optimization

### Multi-Layer Caching:
1. **In-Memory Cache**: LRU cache for ultra-fast access
2. **Redis Cache**: Distributed cache for API results
3. **Database Cache**: Validated addresses table

### Cache TTLs:
- Validated addresses: 30 days
- Geocoding results: 30 days
- Service area config: Session lifetime

## Usage Examples

### Frontend Integration

```javascript
// Quick check during form input
const quickCheck = await fetch(`/api/check-service-boundary?postalCode=${postalCode}`);
const { isLikelyInServiceArea } = await quickCheck.json();

// Full validation before submission
const validation = await fetch('/api/check-service-boundary', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    street: 'Vrijthof',
    houseNumber: '1',
    postalCode: '6211LD',
    city: 'Maastricht'
  })
});

const result = await validation.json();
if (!result.validation.isInServiceArea) {
  alert(result.validation.message);
}
```

### Batch Validation

```javascript
// Validate multiple addresses
const batchValidation = await fetch('/api/check-service-boundary', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    addresses: [
      { street: 'Markt', houseNumber: '1', postalCode: '6211CK', city: 'Maastricht' },
      { street: 'Stationsplein', houseNumber: '1', postalCode: '5211AP', city: 'Den Bosch' }
    ]
  })
});
```

## Configuration

### Environment Variables
```env
# Google Calendar
GOOGLE_CALENDAR_ID=your-calendar-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Database
DATABASE_URL=postgresql://user:password@host:port/database

# Redis
REDIS_URL=redis://localhost:6379
```

### Database Migration
```bash
# Run migration to create boundary tables
psql -d your_database -f prisma/migrations/add_service_boundaries.sql
```

## Extending to Other Provinces

To add support for additional provinces:

1. **Add Service Area**:
```sql
INSERT INTO service_areas (name, province, calendar_color_id, sales_person_name)
VALUES ('Noord-Brabant', 'Noord-Brabant', '7', 'Brabant Sales Team');
```

2. **Add Postal Code Ranges**:
```sql
INSERT INTO postal_code_ranges (service_area_id, start_code, end_code)
SELECT id, '5000', '5799' FROM service_areas WHERE name = 'Noord-Brabant';
```

3. **Update Boundary Validator** (if needed):
- Add province-specific validation rules
- Update quick check logic

## Error Handling

### Common Error Responses:

**Address Outside Service Area**:
```json
{
  "error": "Address outside service area",
  "message": "Het adres ligt buiten ons servicegebied (provincie Limburg)",
  "confidence": 100,
  "validationMethod": "geocoding"
}
```

**Invalid Postal Code Format**:
```json
{
  "error": "Validation error",
  "details": [{
    "path": ["postalCode"],
    "message": "Invalid Dutch postal code"
  }]
}
```

## Monitoring & Maintenance

### Performance Metrics:
- Track cache hit rates
- Monitor API call volumes
- Measure validation response times

### Regular Maintenance:
- Update postal code ranges for boundary changes
- Clear cache after service area updates
- Monitor Google Maps API usage/costs

## Security Considerations

1. **Rate Limiting**: Implement for public endpoints
2. **Authentication**: Require tokens for batch operations
3. **Data Privacy**: Don't log full addresses
4. **API Keys**: Secure storage and rotation

## Future Enhancements

1. **Polygon Boundaries**: More precise geographic boundaries
2. **Multiple Sales Territories**: Sub-divide provinces
3. **Dynamic Assignment**: Auto-assign based on capacity
4. **Travel Time Zones**: Service areas based on drive time
5. **Historical Analysis**: Track out-of-area requests