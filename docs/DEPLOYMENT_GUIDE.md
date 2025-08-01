# StayCool Airco - Production Deployment Guide

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [Deployment Process](#deployment-process)
5. [Post-Deployment](#post-deployment)
6. [Monitoring & Alerts](#monitoring--alerts)
7. [Troubleshooting](#troubleshooting)
8. [Rollback Procedures](#rollback-procedures)
9. [Security Checklist](#security-checklist)
10. [Maintenance](#maintenance)

## Overview

This guide covers the complete deployment process for StayCool Airco's appointment booking system on Netlify with serverless functions, custom domain configuration, and comprehensive monitoring.

### Architecture Summary

- **Frontend**: Next.js 15 with TypeScript
- **Backend**: Netlify Functions (AWS Lambda)
- **Database**: PostgreSQL (Supabase)
- **Cache**: Redis
- **CDN**: Netlify Edge
- **Monitoring**: Datadog, Sentry
- **Domain**: staycoolairco.nl

## Prerequisites

### Required Tools

- Node.js 22.16.0 (exact version)
- npm 10.x
- Netlify CLI (`npm install -g netlify-cli`)
- Git
- OpenSSL (for generating secrets)

### Access Requirements

- Netlify account with deployment permissions
- Access to domain registrar DNS settings
- Database credentials (Supabase)
- API keys for all services
- Monitoring service accounts

### Pre-Deployment Checklist

- [ ] All tests passing (`npm run test:all`)
- [ ] Environment variables configured
- [ ] SSL certificate ready
- [ ] Database migrations prepared
- [ ] Monitoring alerts configured
- [ ] Rollback plan documented

## Environment Setup

### 1. Generate Secure Secrets

```bash
# Generate JWT secrets
openssl rand -base64 32  # For JWT_SECRET
openssl rand -base64 32  # For JWT_REFRESH_SECRET

# Generate encryption key (exactly 32 characters)
openssl rand -hex 16     # For ENCRYPTION_KEY

# Generate API key
openssl rand -hex 32     # For INTERNAL_API_KEY
```

### 2. Configure Environment Variables

Copy `.env.production.example` to `.env.production` and fill in all values:

```bash
cp .env.production.example .env.production
# Edit with your actual values
```

### 3. Validate Environment

```bash
npm run validate:env
```

This will check:
- Required variables are set
- Values meet security requirements
- Database connection is valid
- API keys are properly formatted

### 4. Set Netlify Environment Variables

```bash
# Using Netlify CLI
netlify env:set JWT_SECRET "your-secret-here"
netlify env:set DATABASE_URL "postgresql://..."

# Or use Netlify UI: Site Settings → Environment Variables
```

## Deployment Process

### Automated Deployment

Use the production deployment script:

```bash
# Deploy to production
./scripts/deploy.sh production

# Deploy to staging
./scripts/deploy.sh staging
```

The script will:
1. Run pre-deployment checks
2. Build the application
3. Deploy to Netlify
4. Run health checks
5. Execute smoke tests
6. Rollback on failure

### Manual Deployment Steps

If you need to deploy manually:

#### 1. Build the Application

```bash
# Validate environment
npm run validate:env

# Generate Prisma client
npm run prisma:generate

# Run production build
npm run build:production
```

#### 2. Deploy Database Migrations

```bash
# Check pending migrations
npx prisma migrate status

# Deploy migrations (if needed)
npx prisma migrate deploy
```

#### 3. Deploy to Netlify

```bash
# Deploy to production
netlify deploy --prod

# Deploy to staging
netlify deploy --alias staging
```

#### 4. Verify Deployment

```bash
# Check deployment status
netlify status

# Open site
netlify open:site
```

## Post-Deployment

### 1. Health Checks

Verify all systems are operational:

```bash
# Main health check
curl https://staycoolairco.nl/api/health

# Specific service checks
curl https://staycoolairco.nl/api/appointments/availability
curl https://staycoolairco.nl/api/service-areas
```

Expected response:
```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "ok" },
    "cache": { "status": "ok" },
    "googleMaps": { "status": "ok" },
    "goHighLevel": { "status": "ok" }
  }
}
```

### 2. Smoke Tests

Run critical path tests:

```bash
npx playwright test --grep @smoke
```

### 3. Performance Verification

Check Core Web Vitals:
- Lighthouse CI results in Netlify
- PageSpeed Insights: https://pagespeed.web.dev
- WebPageTest: https://www.webpagetest.org

### 4. Security Verification

- SSL Labs: https://www.ssllabs.com/ssltest/analyze.html?d=staycoolairco.nl
- Security Headers: https://securityheaders.com/?q=staycoolairco.nl
- Mozilla Observatory: https://observatory.mozilla.org

### 5. Clear CDN Cache

```bash
# Via Netlify CLI
netlify build:cancel

# Or via API
curl -X POST https://api.netlify.com/api/v1/sites/$NETLIFY_SITE_ID/purge \
     -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN"
```

## Monitoring & Alerts

### Active Monitoring

1. **Uptime Monitoring**
   - Primary: https://staycoolairco.nl
   - Health: https://staycoolairco.nl/api/health
   - Interval: 1 minute

2. **Performance Monitoring**
   - Response time threshold: 3s
   - Error rate threshold: 5%
   - Apdex target: 0.9

3. **Business Metrics**
   - Appointments created per hour
   - Cancellation rate
   - User registrations

### Alert Channels

Configured in `monitoring/alerts.yml`:
- **Critical**: Email + SMS + Slack
- **High**: Email + Slack
- **Medium**: Slack
- **Low**: Logged only

### Accessing Metrics

- **Datadog**: https://app.datadoghq.eu
- **Netlify Analytics**: https://app.netlify.com/sites/[site-name]/analytics
- **Sentry**: https://sentry.io/organizations/staycool-airco

### Custom Metrics Endpoint

```bash
# Prometheus format metrics
curl https://staycoolairco.nl/api/monitoring
```

## Troubleshooting

### Common Issues

#### 1. Build Failures

```bash
# Check build logs
netlify build:info

# Common fixes:
rm -rf node_modules package-lock.json
npm install
npm run build:production
```

#### 2. Function Timeouts

- Check function logs in Netlify UI
- Increase timeout in netlify.toml
- Optimize database queries
- Implement caching

#### 3. Database Connection Issues

```bash
# Test connection
npx prisma db pull

# Reset connection pool
# Restart functions via Netlify UI
```

#### 4. SSL/Domain Issues

- Verify DNS propagation: `dig staycoolairco.nl`
- Check SSL: `openssl s_client -connect staycoolairco.nl:443`
- Re-provision certificate in Netlify

### Debug Mode

Enable debug logging:

```bash
# Set in Netlify environment
ENABLE_DEBUG_MODE=true
LOG_LEVEL=debug
```

### Function Logs

Access via Netlify CLI:
```bash
netlify functions:log health-check --tail
```

Or Netlify UI: Functions → Logs

## Rollback Procedures

### Automatic Rollback

The deployment script includes automatic rollback on failure:
- Health check failures
- Smoke test failures
- Within 5-minute window

### Manual Rollback

#### Option 1: Via Netlify UI

1. Go to Deploys tab
2. Find previous successful deployment
3. Click "Publish deploy"

#### Option 2: Via CLI

```bash
# List recent deploys
netlify deploy:list

# Restore specific deploy
netlify deploy:restore --deploy-id=<deploy-id>
```

#### Option 3: Emergency Script

```bash
# Rollback to last known good
./scripts/rollback.sh

# Rollback to specific deploy
./scripts/rollback.sh <deploy-id>
```

### Database Rollback

If database changes need reverting:

```bash
# Check migration history
npx prisma migrate status

# Revert last migration
npx prisma migrate reset --skip-seed
```

## Security Checklist

### Pre-Deployment

- [ ] All dependencies updated (`npm audit`)
- [ ] Secrets rotated if compromised
- [ ] Security headers configured
- [ ] CSP policy reviewed
- [ ] Rate limiting enabled

### Post-Deployment

- [ ] SSL certificate valid (A+ rating)
- [ ] Security headers score (A+)
- [ ] No exposed secrets in logs
- [ ] API endpoints authenticated
- [ ] CORS properly configured

### Regular Security Tasks

- Weekly: Review security alerts
- Monthly: Rotate API keys
- Quarterly: Security audit
- Annually: Penetration testing

## Maintenance

### Scheduled Maintenance Windows

Defined in `monitoring/alerts.yml`:
- Weekly: Sunday 3:00-5:00 AM CET
- Monthly: First Sunday 2:00-6:00 AM CET

### Maintenance Mode

Enable maintenance mode:

```bash
# Set in Netlify
netlify env:set ENABLE_MAINTENANCE_MODE true

# Deploy immediately
netlify deploy --prod
```

Custom maintenance page at `/app/maintenance.tsx`

### Database Maintenance

```bash
# Vacuum and analyze
psql $DATABASE_URL -c "VACUUM ANALYZE;"

# Update statistics
psql $DATABASE_URL -c "ANALYZE;"
```

### Dependency Updates

```bash
# Check for updates
npm outdated

# Update dependencies
npm update

# Test after updates
npm run test:all
```

### SSL Certificate Renewal

Automated via Let's Encrypt, but verify:
- 30 days before expiry: Warning alert
- 7 days before expiry: Critical alert
- Manual renewal if needed via Netlify UI

## Emergency Contacts

- **On-Call Engineer**: +31 6 12345678
- **Netlify Support**: https://www.netlify.com/support/
- **Supabase Support**: support@supabase.io
- **Domain Registrar**: [Your registrar support]

## Deployment Approvals

For production deployments:
1. Code review approved
2. QA sign-off
3. Business stakeholder approval
4. Deployment window confirmed

---

Last Updated: 2025-08-01
Version: 2.0.0