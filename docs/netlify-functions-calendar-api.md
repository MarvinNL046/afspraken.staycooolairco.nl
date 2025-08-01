# Google Calendar API Netlify Functions Documentation

This document describes the Netlify Functions created for Google Calendar integration with full Dutch timezone (Europe/Amsterdam) support.

## Overview

The implementation provides serverless functions for appointment management with Google Calendar synchronization:

1. **check-availability** - Check available time slots for a given date
2. **create-appointment** - Create new appointments with Google Calendar sync
3. **manage-appointment** - Update or cancel existing appointments
4. **get-appointment** - Retrieve appointment details
5. **sync-calendar** - Batch synchronization between database and Google Calendar

## Environment Variables

Add the following to your `.env` file:

```env
# Google Calendar Configuration
GOOGLE_SERVICE_ACCOUNT_KEY=<base64-encoded-service-account-json>
GOOGLE_CALENDAR_ID=<your-google-calendar-id>

# Security Keys
JWT_SECRET=<your-jwt-secret-key>
ADMIN_API_KEY=<your-admin-api-key>

# CORS Configuration
ALLOWED_ORIGIN=https://yourdomain.com  # Production domain
NODE_ENV=production  # or development

# Database (already configured)
DATABASE_URL=<your-database-url>
```

## API Endpoints

### 1. Check Availability

**Endpoint:** `/.netlify/functions/check-availability`  
**Method:** GET  
**Authentication:** None required (public endpoint)

**Query Parameters:**
- `date` (required): Date in YYYY-MM-DD format

**Example Request:**
```bash
GET /.netlify/functions/check-availability?date=2024-01-15
```

**Response:**
```json
{
  "date": "2024-01-15",
  "timezone": "Europe/Amsterdam",
  "businessHours": {
    "start": "08:00",
    "end": "18:00",
    "lunchBreak": {
      "start": "12:00",
      "end": "13:00"
    }
  },
  "slotDuration": 120,
  "slots": [
    {
      "id": "cuid",
      "startTime": "08:00",
      "endTime": "10:00",
      "isAvailable": true,
      "displayTime": "08:00 - 10:00"
    },
    // ... more slots
  ],
  "totalSlots": 4,
  "availableSlots": 3
}
```

### 2. Create Appointment

**Endpoint:** `/.netlify/functions/create-appointment`  
**Method:** POST  
**Authentication:** Booking token required

**Request Body:**
```json
{
  "date": "2024-01-15",
  "startTime": "10:00",
  "serviceType": "onderhoud",
  "customerInfo": {
    "firstName": "Jan",
    "lastName": "de Vries",
    "email": "jan@example.com",
    "phone": "+31612345678",
    "address": "Hoofdstraat 123",
    "city": "Amsterdam",
    "postalCode": "1234 AB"
  },
  "notes": "Airco maakt vreemd geluid",
  "bookingToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Service Types:**
- Dutch: `onderhoud`, `storing`, `inspectie`, `installatie`
- English: `maintenance`, `malfunction`, `inspection`, `installation`

**Response:**
```json
{
  "success": true,
  "appointment": {
    "id": "cuid",
    "date": "2024-01-15",
    "time": "10:00",
    "endTime": "12:00",
    "serviceType": "onderhoud",
    "status": "scheduled",
    "customer": {
      "name": "Jan de Vries",
      "email": "jan@example.com",
      "phone": "+31612345678",
      "address": "Hoofdstraat 123, 1234 AB Amsterdam"
    },
    "timezone": "Europe/Amsterdam",
    "googleCalendarSynced": true
  },
  "message": "Appointment successfully created"
}
```

### 3. Manage Appointment

**Endpoint:** `/.netlify/functions/manage-appointment`  
**Methods:** PATCH (update), DELETE (cancel)  
**Authentication:** Booking token required

#### Update Appointment (PATCH)

**Request Body:**
```json
{
  "appointmentId": "cuid",
  "date": "2024-01-16",  // optional
  "startTime": "14:00",   // optional
  "serviceType": "inspectie",  // optional
  "notes": "Updated notes",  // optional
  "bookingToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### Cancel Appointment (DELETE)

**Request Body:**
```json
{
  "appointmentId": "cuid",
  "reason": "Customer request",  // optional
  "bookingToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

### 4. Get Appointment Details

**Endpoint:** `/.netlify/functions/get-appointment`  
**Method:** GET  
**Authentication:** Booking token required

**Query Parameters:**
- `appointmentId` (optional): Specific appointment ID
- `bookingToken` (required): Can be passed as query param or Authorization header

**Example Requests:**
```bash
# Get specific appointment
GET /.netlify/functions/get-appointment?appointmentId=cuid&bookingToken=eyJ...

# Get all appointments for lead
GET /.netlify/functions/get-appointment?bookingToken=eyJ...

# Using Authorization header
GET /.netlify/functions/get-appointment
Authorization: Bearer eyJ...
```

### 5. Sync Calendar (Admin Only)

**Endpoint:** `/.netlify/functions/sync-calendar`  
**Method:** POST  
**Authentication:** Admin API key required

**Request Body:**
```json
{
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",  // optional, defaults to startDate + 30 days
  "direction": "toCalendar",  // toCalendar | fromCalendar | bidirectional
  "apiKey": "your-admin-api-key"
}
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "totalSynced": 15,
    "created": 5,
    "updated": 10,
    "errors": 0
  },
  "dateRange": {
    "start": "2024-01-01",
    "end": "2024-01-31",
    "timezone": "Europe/Amsterdam"
  },
  "direction": "toCalendar",
  "details": [...]
}
```

## Security Features

1. **JWT-based Authentication**: Booking tokens validate customer access
2. **CORS Protection**: Configurable allowed origins
3. **Rate Limiting**: Handled by Netlify (configurable)
4. **Input Validation**: Zod schemas validate all inputs
5. **SQL Injection Protection**: Prisma ORM prevents SQL injection
6. **Admin Endpoints**: Protected with API key authentication

## Timezone Handling

All functions properly handle Dutch timezone (Europe/Amsterdam):

- **Input**: Dates and times are interpreted as Amsterdam time
- **Storage**: Converted to UTC for database storage
- **Output**: Displayed in Amsterdam time with timezone indicator
- **Business Hours**: 08:00-18:00 Amsterdam time
- **Lunch Break**: 12:00-13:00 Amsterdam time
- **Appointment Duration**: 2 hours (120 minutes)

## Error Handling

All functions return consistent error responses:

```json
{
  "error": "Error type",
  "message": "Human-readable error message",
  "details": []  // Optional validation details
}
```

**HTTP Status Codes:**
- 200: Success
- 201: Created
- 400: Bad Request (validation errors)
- 401: Unauthorized (invalid token)
- 403: Forbidden (insufficient permissions)
- 404: Not Found
- 405: Method Not Allowed
- 409: Conflict (e.g., time slot already booked)
- 500: Internal Server Error

## Client Integration Example

```javascript
// Check availability
const checkAvailability = async (date) => {
  const response = await fetch(`/.netlify/functions/check-availability?date=${date}`);
  return response.json();
};

// Create appointment
const createAppointment = async (appointmentData, bookingToken) => {
  const response = await fetch('/.netlify/functions/create-appointment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...appointmentData,
      bookingToken
    })
  });
  return response.json();
};

// Update appointment
const updateAppointment = async (appointmentId, updates, bookingToken) => {
  const response = await fetch('/.netlify/functions/manage-appointment', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      appointmentId,
      ...updates,
      bookingToken
    })
  });
  return response.json();
};

// Cancel appointment
const cancelAppointment = async (appointmentId, reason, bookingToken) => {
  const response = await fetch('/.netlify/functions/manage-appointment', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      appointmentId,
      reason,
      bookingToken
    })
  });
  return response.json();
};
```

## Deployment Notes

1. **Environment Variables**: Ensure all required environment variables are set in Netlify
2. **Build Command**: Functions are automatically built by Netlify
3. **Node Version**: Requires Node.js 18+ (configured in netlify.toml)
4. **Google Service Account**: Must have Calendar API permissions
5. **Database**: Ensure DATABASE_URL is configured for production

## Monitoring and Debugging

1. **Netlify Functions Log**: Check function logs in Netlify dashboard
2. **Error Tracking**: All errors are logged with context
3. **Google Calendar Sync**: Sync errors don't fail appointments (graceful degradation)
4. **Performance**: Functions include Prisma connection cleanup to prevent connection leaks

## Future Enhancements

1. **Webhook Support**: Real-time notifications for appointment changes
2. **Recurring Appointments**: Support for weekly/monthly recurring appointments
3. **Multi-Calendar Support**: Support for multiple technician calendars
4. **SMS Notifications**: Integration with SMS providers for reminders
5. **Advanced Availability**: Support for different service durations and buffer times