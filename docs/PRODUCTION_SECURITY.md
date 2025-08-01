# Production Security Hardening Implementation

## Overview

This document details the comprehensive security hardening implementation for the StayCool appointment booking system. All security measures have been implemented following OWASP best practices and industry standards.

## Implementation Summary

### 1. HTTPS Configuration ✅

**File**: `middleware.ts`

- Enforces HTTPS in production environments
- Automatic redirect from HTTP to HTTPS
- HSTS header with preload enabled
- SSL/TLS minimum version 1.2

### 2. Security Headers ✅

**File**: `middleware.ts`

Comprehensive security headers including:
- Content Security Policy (CSP)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy
- Strict-Transport-Security

### 3. CORS Configuration ✅

**Files**: 
- `lib/middleware/cors.ts`
- `middleware.ts`

Features:
- Environment-specific allowed origins
- Credentials support for authenticated requests
- Preflight request handling
- Custom CORS configurations per endpoint

### 4. Input Validation ✅

**File**: `lib/middleware/input-validation.ts`

Comprehensive validation including:
- Schema-based validation with Zod
- Dutch-specific formats (postcode, phone)
- HTML sanitization with DOMPurify
- SQL injection prevention
- XSS protection
- Path traversal prevention
- Command injection prevention
- Prototype pollution protection

### 5. Rate Limiting ✅

**Files**:
- `lib/middleware/security.middleware.ts`
- `lib/config/security.ts`

Rate limits by endpoint type:
- Booking: 5 requests per 15 minutes
- Authentication: 10 requests per 15 minutes
- General API: 60 requests per minute
- Automatic IP blocking for suspicious activity

### 6. Security Monitoring ✅

**Files**:
- `lib/services/security/security-monitor.ts`
- `lib/services/monitoring/monitor.ts`
- `app/admin/monitoring/page.tsx`

Features:
- Real-time threat detection
- Security event tracking
- Automatic client blocking
- Incident logging
- Dashboard for monitoring

### 7. Authentication & Authorization ✅

**Files**:
- `lib/middleware/auth.middleware.ts`
- `lib/services/auth/jwt.service.ts`
- `lib/services/auth/lead-validation.service.ts`

JWT-based authentication with:
- HS512 algorithm
- 1-hour token lifetime
- Refresh tokens (7 days)
- Session management
- Lead validation

### 8. Secure API Handler ✅

**File**: `lib/middleware/secure-handler.ts`

Unified security wrapper providing:
- Authentication enforcement
- Input validation
- Rate limiting
- CORS handling
- Error handling
- Performance tracking

## Usage Examples

### Creating a Secure API Endpoint

```typescript
import { createSecureHandler, SECURITY_PRESETS } from '@/lib/middleware/secure-handler';
import { validationSchemas } from '@/lib/middleware/input-validation';

// Public endpoint (no auth required)
export const GET = createSecureHandler(
  {
    ...SECURITY_PRESETS.public,
  },
  async (request) => {
    // Handle request
    return NextResponse.json({ data: 'public data' });
  }
);

// Authenticated endpoint with validation
export const POST = createSecureHandler(
  {
    ...SECURITY_PRESETS.authenticated,
    schema: validationSchemas.createBooking,
  },
  async (request, validatedData) => {
    // request.auth contains user info
    // validatedData is validated and sanitized
    const { leadId, email } = request.auth;
    
    // Handle the booking
    return NextResponse.json({ success: true });
  }
);
```

### Custom Validation Schema

```typescript
import { z } from 'zod';
import { commonSchemas } from '@/lib/middleware/input-validation';

const customSchema = z.object({
  email: commonSchemas.email,
  phone: commonSchemas.phone,
  customField: z.string().max(100),
});

export const POST = createSecureHandler(
  {
    requireAuth: true,
    schema: customSchema,
  },
  handler
);
```

## Security Features by Layer

### 1. Edge Layer (Next.js Middleware)
- HTTPS enforcement
- Security headers
- Request filtering
- Path protection

### 2. API Layer
- Rate limiting
- CORS protection
- Input validation
- Authentication

### 3. Application Layer
- Error boundaries
- Secure session management
- Data sanitization
- Logging

### 4. Data Layer
- Parameterized queries (Prisma)
- Encryption at rest
- Access control
- Audit logging

## Monitoring and Alerts

### Security Events Tracked

1. **Authentication Events**
   - LOGIN_SUCCESS
   - LOGIN_FAILED
   - TOKEN_EXPIRED
   - TOKEN_INVALID

2. **Security Violations**
   - RATE_LIMIT_EXCEEDED
   - CORS_VIOLATION
   - SQL_INJECTION_ATTEMPT
   - XSS_ATTEMPT
   - PATH_TRAVERSAL_ATTEMPT

3. **Access Control**
   - ACCESS_GRANTED
   - ACCESS_DENIED
   - PRIVILEGE_ESCALATION

### Monitoring Dashboard

Access at: `/admin/monitoring`

Features:
- Real-time security events
- Threat level indicators
- Rate limit statistics
- Performance metrics
- Error tracking

## Environment Configuration

### Required Environment Variables

```env
# Production settings
NODE_ENV=production

# Security secrets (generate strong values)
JWT_SECRET_KEY=<32+ character random string>
ENCRYPTION_KEY=<32-byte hex string>
CSRF_SECRET=<32+ character random string>

# Database
DATABASE_URL=<production database URL>

# Optional monitoring
MONITORING_ENABLED=true
LOG_LEVEL=warn
ALERT_WEBHOOK_URL=<webhook for critical alerts>

# CORS (optional override)
CORS_ALLOWED_ORIGINS=https://staycoolairco.nl,https://www.staycoolairco.nl
```

### Netlify Configuration

Add to `netlify.toml`:

```toml
[build.environment]
  NODE_ENV = "production"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

## Testing Security

### Automated Security Tests

```bash
# Run security test suite
npm run test:security

# Check for vulnerabilities
npm audit --production

# Lint for security issues
npm run lint
```

### Manual Security Checklist

- [ ] Test HTTPS redirect
- [ ] Verify security headers (use securityheaders.com)
- [ ] Test rate limiting
- [ ] Attempt SQL injection
- [ ] Attempt XSS
- [ ] Test CORS from different origins
- [ ] Verify JWT expiration
- [ ] Test input validation
- [ ] Check error messages (no sensitive data)
- [ ] Monitor security events

## Maintenance

### Regular Security Tasks

1. **Daily**
   - Monitor security dashboard
   - Review security alerts
   - Check blocked IPs

2. **Weekly**
   - Review security logs
   - Check rate limit effectiveness
   - Update threat patterns

3. **Monthly**
   - Security dependency updates
   - Penetration testing
   - Security metric review

4. **Quarterly**
   - Full security audit
   - Update security documentation
   - Review and update security policies

## Incident Response

### Security Incident Procedure

1. **Detection**
   - Automated alerts
   - Dashboard monitoring
   - User reports

2. **Assessment**
   - Determine severity
   - Identify affected systems
   - Evaluate data exposure

3. **Containment**
   - Block malicious IPs
   - Disable compromised accounts
   - Isolate affected systems

4. **Remediation**
   - Fix vulnerabilities
   - Reset credentials
   - Update security measures

5. **Recovery**
   - Restore services
   - Verify security
   - Monitor closely

6. **Post-Incident**
   - Document incident
   - Update procedures
   - Implement improvements

## Compliance

### GDPR Compliance
- Data minimization
- Encryption at rest and in transit
- Right to erasure
- Data portability
- Privacy by design

### Security Standards
- OWASP Top 10 protection
- NIST guidelines
- Industry best practices

## Support

For security-related issues:

1. **Critical vulnerabilities**: security@staycoolairco.nl
2. **Implementation questions**: Development team
3. **Monitoring alerts**: Check dashboard first
4. **Updates**: Review this documentation

---

Last Updated: August 2025
Version: 1.0.0