# Error Handling, Logging & Monitoring System

## Overview

This comprehensive error handling system provides:
- **Centralized Error Types**: Strongly typed error classes with severity levels
- **Structured Logging**: Context-aware logging with multiple transports
- **Real-time Monitoring**: Metrics collection, alerting, and health checks
- **Graceful Degradation**: Automatic fallbacks and service degradation
- **Error Boundaries**: React error boundaries for UI resilience
- **Health Endpoints**: System health monitoring and diagnostics

## Architecture

### 1. Error Types (`lib/errors/types.ts`)

Centralized error definitions with:
- **Error Codes**: Categorized error identifiers
- **Severity Levels**: LOW, MEDIUM, HIGH, CRITICAL
- **Error Categories**: Authentication, Validation, Business Logic, External Services, Infrastructure
- **Custom Error Classes**: AppError base class with specialized extensions

### 2. Logging Service (`lib/services/logging/logger.ts`)

Structured logging with:
- **Log Levels**: DEBUG, INFO, WARN, ERROR, FATAL
- **Multiple Transports**: Console, File, External services
- **Context Preservation**: Request ID, User ID, Session tracking
- **Performance Logging**: Operation timing and metrics
- **Sensitive Data Protection**: Automatic redaction of passwords, tokens, etc.

### 3. Monitoring System (`lib/services/monitoring/monitor.ts`)

Comprehensive monitoring with:
- **Metrics Collection**: Counters, Gauges, Histograms
- **Alert Management**: Threshold-based alerts with severity levels
- **Health Monitoring**: Component health checks
- **Performance Tracking**: Response times, error rates, throughput
- **Dashboard Data**: Real-time metrics aggregation

### 4. Graceful Degradation (`lib/services/graceful-degradation.ts`)

Service resilience with:
- **Circuit Breakers**: Automatic service isolation
- **Feature Flags**: Dynamic feature toggling based on health
- **Fallback Strategies**: Alternative implementations for critical services
- **Service Status Tracking**: HEALTHY, DEGRADED, CRITICAL, OFFLINE states

### 5. Error Boundaries (`components/error-boundary.tsx`)

React error handling with:
- **Component Isolation**: Prevent cascading failures
- **User-friendly Fallbacks**: Graceful error displays
- **Async Error Handling**: Support for code splitting and lazy loading
- **Route-level Protection**: Full page error boundaries

### 6. Error Middleware (`lib/middleware/error-handler.ts`)

API error handling with:
- **Centralized Error Processing**: Consistent error responses
- **Retry Logic**: Exponential backoff with jitter
- **Database Error Mapping**: User-friendly database error messages
- **External Service Wrapping**: Automatic error handling for third-party APIs

## Usage Examples

### Basic Error Handling

```typescript
import { AppError, ErrorCode, ErrorSeverity } from '@/lib/errors/types';
import { logger } from '@/lib/services/logging/logger';

// Throw a custom error
throw new AppError(
  'User not found',
  ErrorCode.NOT_FOUND,
  404,
  ErrorSeverity.LOW,
  { userId: '123' }
);

// Log with context
logger.error('Operation failed', error, {
  operation: 'user.fetch',
  userId: '123'
});
```

### API Route Protection

```typescript
import { withErrorHandler } from '@/lib/middleware/error-handler';

export const GET = withErrorHandler(async (request: NextRequest) => {
  // Your API logic here
  // Errors are automatically caught and formatted
});
```

### Database Operations

```typescript
import { withDatabaseErrorHandler } from '@/lib/middleware/error-handler';

const fetchUser = withDatabaseErrorHandler(
  'user.fetch',
  async (userId: string) => {
    return await prisma.user.findUnique({ where: { id: userId } });
  }
);
```

### External Service Calls

```typescript
import { withExternalServiceErrorHandler } from '@/lib/middleware/error-handler';

const callGoogleMaps = withExternalServiceErrorHandler(
  'google-maps',
  'geocode',
  async (address: string) => {
    return await googleMaps.geocode(address);
  }
);
```

### Graceful Degradation

```typescript
import { withGracefulDegradation } from '@/lib/middleware/error-handler';
import { FallbackStrategies } from '@/lib/services/graceful-degradation';

const geocodeAddress = withGracefulDegradation(
  async (address: string) => {
    // Primary implementation
    return await googleMaps.geocode(address);
  },
  async (address: string) => {
    // Fallback implementation
    return await FallbackStrategies.geocodingFallback(address);
  }
);
```

### React Error Boundaries

```tsx
import { ErrorBoundary, RouteErrorBoundary } from '@/components/error-boundary';

// Component-level protection
<ErrorBoundary>
  <YourComponent />
</ErrorBoundary>

// Route-level protection
export default function Layout({ children }) {
  return (
    <RouteErrorBoundary>
      {children}
    </RouteErrorBoundary>
  );
}
```

### Health Checks

```typescript
// Simple health check
GET /.netlify/functions/health-simple

// Detailed health check
GET /.netlify/functions/health?detailed=true
```

### Monitoring Dashboard

Access the monitoring dashboard at `/admin/monitoring` to view:
- System health status
- Service availability
- Performance metrics
- Active alerts
- Error statistics
- Resource utilization

## Configuration

### Environment Variables

```env
# Logging
LOG_LEVEL=info

# Monitoring
MONITORING_ENABLED=true
ALERT_WEBHOOK_URL=https://your-webhook-url

# External monitoring service (optional)
MONITORING_API_KEY=your-api-key
MONITORING_ENDPOINT=https://monitoring-service.com
```

### Custom Alerts

```typescript
import { monitoring } from '@/lib/services/monitoring/monitor';

// Register custom alert
monitoring.alerts.registerAlert({
  id: 'high_booking_errors',
  name: 'High Booking Error Rate',
  condition: {
    metric: 'booking_errors_total',
    operator: '>',
    threshold: 10,
    duration: 300, // 5 minutes
    severity: AlertSeverity.ERROR,
  },
  message: 'Booking errors exceed threshold',
  severity: AlertSeverity.ERROR,
  triggered: false,
});
```

### Custom Health Checks

```typescript
import { monitoring } from '@/lib/services/monitoring/monitor';

// Register custom health check
monitoring.health.register('payment-gateway', async () => {
  try {
    const response = await checkPaymentGateway();
    return {
      name: 'payment-gateway',
      status: response.ok ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
      message: response.message,
    };
  } catch (error) {
    return {
      name: 'payment-gateway',
      status: HealthStatus.UNHEALTHY,
      message: error.message,
    };
  }
});
```

## Best Practices

### 1. Use Appropriate Error Types
- Use specific error classes (ValidationError, AuthenticationError, etc.)
- Set correct severity levels for proper alerting
- Include relevant context for debugging

### 2. Log at the Right Level
- DEBUG: Detailed debugging information
- INFO: General informational messages
- WARN: Warning conditions that should be reviewed
- ERROR: Error conditions that need attention
- FATAL: Critical errors requiring immediate action

### 3. Implement Circuit Breakers
- Use circuit breakers for external services
- Configure appropriate thresholds and timeouts
- Implement meaningful fallback strategies

### 4. Monitor Key Metrics
- Response times
- Error rates
- Cache hit rates
- Resource utilization
- Service availability

### 5. Test Error Scenarios
- Test error boundaries with error injection
- Verify graceful degradation behavior
- Ensure logging captures necessary context
- Validate alert thresholds

## Troubleshooting

### High Error Rates
1. Check monitoring dashboard for patterns
2. Review error logs for root causes
3. Verify external service health
4. Check for deployment issues

### Performance Degradation
1. Review performance metrics
2. Check cache hit rates
3. Monitor database query times
4. Verify external service latencies

### Alert Fatigue
1. Adjust alert thresholds
2. Group related alerts
3. Implement alert suppression
4. Review severity levels

### Missing Logs
1. Verify LOG_LEVEL setting
2. Check log transport configuration
3. Ensure proper error propagation
4. Review context sanitization

## Migration Guide

### From Console.log to Logger

```typescript
// Before
console.log('User logged in', userId);
console.error('Login failed', error);

// After
logger.info('User logged in', { userId });
logger.error('Login failed', error, { userId });
```

### From Try-Catch to Error Handlers

```typescript
// Before
try {
  const user = await fetchUser(id);
} catch (error) {
  console.error(error);
  return res.status(500).json({ error: 'Internal error' });
}

// After
const fetchUserWithErrorHandling = withDatabaseErrorHandler(
  'user.fetch',
  fetchUser
);
```

### From Basic Health Check to Comprehensive Monitoring

```typescript
// Before
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// After
// Automatic health checks with detailed component status
// Available at /.netlify/functions/health?detailed=true
```

## Performance Impact

- **Logging Overhead**: ~1-2ms per log entry
- **Monitoring Metrics**: <1ms per metric recording
- **Error Boundaries**: Negligible React render impact
- **Health Checks**: Configurable intervals, typically 60s
- **Memory Usage**: ~10-20MB for monitoring data

## Security Considerations

- Sensitive data is automatically redacted from logs
- Error messages in production hide implementation details
- Stack traces are only included in development mode
- Request IDs enable tracing without exposing user data
- Admin endpoints require authentication

## Future Enhancements

1. **Distributed Tracing**: OpenTelemetry integration
2. **Advanced Analytics**: ML-based anomaly detection
3. **Auto-scaling Triggers**: Based on performance metrics
4. **Incident Management**: PagerDuty/Opsgenie integration
5. **Performance Profiling**: Detailed performance analysis