# 🔒 Security Documentation - StayCool Appointment Booking System

## Overview

This document outlines the security implementation for the StayCool appointment booking system. The system implements defense-in-depth security principles with multiple layers of protection.

## Architecture

### Security Layers

1. **Authentication Layer** - JWT-based token authentication
2. **Authorization Layer** - Lead validation and access control
3. **Transport Security** - HTTPS enforcement and security headers
4. **Application Security** - Input validation, CSRF protection, rate limiting
5. **Monitoring Layer** - Security logging and audit trails

## Authentication System

### JWT Token Implementation

The system uses JWT (JSON Web Tokens) for stateless authentication:

- **Algorithm**: HS512 (HMAC SHA-512)
- **Token Types**:
  - Access Token (1 hour validity)
  - Refresh Token (7 days validity)
- **Token Storage**: Secure HttpOnly cookies with SameSite=Strict

### Token Flow

```
1. Lead submits email + GoHighLevel ID
2. System validates lead in database
3. If valid, generate token pair
4. Return tokens in secure cookies
5. All subsequent requests include access token
6. Refresh token used when access token expires
```

### Security Features

- ✅ Unique session IDs for each token
- ✅ Token expiration validation
- ✅ Issuer and audience validation
- ✅ IP address and user agent tracking
- ✅ Automatic token refresh hints

## Lead Validation

### Validation Process

1. **Input Validation**: Email and GHL ID format checking
2. **Database Verification**: Lead must exist in database
3. **Suspicious Activity Detection**: New leads require verification
4. **Failed Attempt Tracking**: Account lockout after 5 failed attempts
5. **Verification Code Flow**: 6-digit codes for extra security

### Security Measures

- Email normalization (lowercase)
- Rate limiting on validation attempts
- 30-minute lockout for excessive failures
- Time-based verification codes (10-minute validity)
- Maximum 3 attempts per verification code

## Security Headers

All responses include comprehensive security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: [comprehensive policy]
```

## Rate Limiting

### Endpoint Limits

| Endpoint Type | Window | Max Requests | Purpose |
|--------------|--------|--------------|---------|
| Booking | 15 min | 5 | Prevent booking spam |
| Auth | 15 min | 10 | Prevent brute force |
| API | 1 min | 60 | General API protection |

### Implementation

- Client identification via IP + User Agent hash
- Graceful degradation with proper error messages
- Rate limit headers in responses
- Automatic cleanup of expired entries

## CSRF Protection

- Token generation per session
- Validation on all state-changing requests
- Double-submit cookie pattern
- Secure cookie settings

## Input Validation

### Validation Rules

- **Email**: RFC-compliant, max 254 characters
- **Phone**: Numeric with formatting, max 20 characters
- **GHL ID**: Alphanumeric with dashes/underscores, max 100 characters
- **Dates**: ISO 8601 format validation
- **Times**: HH:MM format validation

### Sanitization

- Null byte removal
- Prototype pollution prevention
- XSS prevention through input escaping
- SQL injection prevention via Prisma ORM

## Security Logging

### Logged Events

- ✅ Authentication success/failure
- ✅ Token generation and refresh
- ✅ Rate limit violations
- ✅ CSRF violations
- ✅ Suspicious activities
- ✅ IP blocking events

### Privacy Protection

- Email hashing (partial hash + domain)
- ID hashing (SHA-256, first 16 chars)
- Sensitive field redaction
- No PII in logs

## Environment Security

### Required Environment Variables

```env
JWT_SECRET_KEY=         # Minimum 32 characters
DATABASE_URL=           # PostgreSQL connection
INTERNAL_API_KEY=       # Server-to-server auth
FRONTEND_URL=           # CORS validation
```

### Best Practices

1. **Secret Management**:
   - Use environment variables
   - Never commit secrets
   - Rotate keys regularly
   - Use strong, random secrets

2. **Database Security**:
   - Use connection pooling
   - Implement query timeouts
   - Use prepared statements (via Prisma)
   - Regular backups

3. **API Security**:
   - Validate all inputs
   - Use HTTPS only
   - Implement proper CORS
   - Version your APIs

## Security Checklist

### Development

- [ ] All dependencies up to date
- [ ] Security headers configured
- [ ] Input validation on all endpoints
- [ ] Error messages don't leak information
- [ ] Logging configured properly

### Deployment

- [ ] HTTPS enforced
- [ ] Environment variables secured
- [ ] Database access restricted
- [ ] Monitoring enabled
- [ ] Backup strategy in place

### Maintenance

- [ ] Regular dependency updates
- [ ] Security log reviews
- [ ] Penetration testing
- [ ] Incident response plan
- [ ] Key rotation schedule

## Incident Response

### Security Incident Procedure

1. **Detection**: Monitor logs for suspicious activity
2. **Containment**: Block affected IPs/users
3. **Investigation**: Analyze logs and impact
4. **Recovery**: Restore service, patch vulnerabilities
5. **Post-Mortem**: Document and improve

### Contact

For security concerns or vulnerability reports:
- Email: security@staycoolairco.nl
- Response time: Within 24 hours

## Testing

### Security Test Coverage

- JWT token generation and validation
- Rate limiting effectiveness
- CSRF protection
- Input validation boundaries
- Authentication flows
- Error handling

### Running Security Tests

```bash
npm run test:security
npm run test:integration
npm run audit
```

## Compliance

The system is designed to comply with:

- ✅ GDPR (General Data Protection Regulation)
- ✅ Dutch privacy laws (AVG)
- ✅ OWASP Top 10 security practices
- ✅ Industry best practices for web security

## Updates and Maintenance

- Security patches: Applied within 24 hours
- Dependency updates: Weekly reviews
- Security audits: Quarterly
- Penetration testing: Annually

---

Last updated: 2024-01-30
Version: 1.0.0