# StayCool Airco - Production Runbook

## Quick Reference

### Critical URLs
- **Production**: https://staycoolairco.nl
- **Health Check**: https://staycoolairco.nl/api/health
- **Monitoring**: https://staycoolairco.nl/api/monitoring
- **Netlify Dashboard**: https://app.netlify.com/sites/staycool-airco
- **Datadog**: https://app.datadoghq.eu
- **Sentry**: https://sentry.io/organizations/staycool-airco

### Emergency Contacts
- **Primary On-Call**: +31 6 12345678
- **Secondary On-Call**: +31 6 87654321
- **Business Owner**: +31 6 11223344
- **Netlify Support**: Premium support ticket

## Common Operations

### 1. Deploy to Production

```bash
# Standard deployment
./scripts/deploy.sh production

# Emergency hotfix
./scripts/deploy.sh production --skip-tests
```

### 2. Rollback Deployment

```bash
# Rollback to previous
./scripts/rollback.sh

# Rollback to specific version
./scripts/rollback.sh <deploy-id>
```

### 3. Enable Maintenance Mode

```bash
# Enable
netlify env:set ENABLE_MAINTENANCE_MODE true
netlify deploy --prod

# Disable
netlify env:set ENABLE_MAINTENANCE_MODE false
netlify deploy --prod
```

### 4. Clear Cache

```bash
# Clear CDN cache
curl -X POST https://api.netlify.com/api/v1/sites/$NETLIFY_SITE_ID/purge \
     -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN"

# Clear Redis cache
redis-cli -h $REDIS_HOST -p 6379 -a $REDIS_PASSWORD FLUSHDB
```

### 5. Scale Functions

```bash
# Increase memory (in netlify.toml)
[functions."appointment-create"]
  memory = 3008  # MB

# Deploy changes
netlify deploy --prod
```

## Incident Response

### Severity Levels

- **P1 (Critical)**: Site down, no bookings possible
- **P2 (High)**: Major feature broken, significant user impact
- **P3 (Medium)**: Minor feature broken, workaround available
- **P4 (Low)**: Cosmetic issues, no user impact

### Response Times

- **P1**: 15 minutes
- **P2**: 1 hour
- **P3**: 4 hours
- **P4**: Next business day

### Incident Checklist

#### 1. Assess Impact
- [ ] Check monitoring dashboards
- [ ] Verify health endpoint
- [ ] Check error rates in Sentry
- [ ] Review recent deployments

#### 2. Communicate
- [ ] Update status page
- [ ] Notify stakeholders via Slack
- [ ] Create incident channel
- [ ] Start incident timer

#### 3. Investigate
- [ ] Check function logs
- [ ] Review error traces
- [ ] Check database status
- [ ] Verify external services

#### 4. Mitigate
- [ ] Apply immediate fix or rollback
- [ ] Scale resources if needed
- [ ] Enable circuit breakers
- [ ] Communicate updates

#### 5. Resolve
- [ ] Verify fix in production
- [ ] Monitor for 30 minutes
- [ ] Update status page
- [ ] Close incident

#### 6. Post-Mortem
- [ ] Document timeline
- [ ] Identify root cause
- [ ] Create action items
- [ ] Share learnings

## Troubleshooting Playbooks

### Site is Down

1. **Check health endpoint**
   ```bash
   curl -I https://staycoolairco.nl/api/health
   ```

2. **Check Netlify status**
   ```bash
   netlify status
   ```

3. **Check DNS**
   ```bash
   dig staycoolairco.nl
   nslookup staycoolairco.nl
   ```

4. **Check SSL**
   ```bash
   openssl s_client -connect staycoolairco.nl:443
   ```

5. **Emergency actions**
   - Rollback recent deployment
   - Clear CDN cache
   - Check domain/SSL expiry

### High Error Rate

1. **Check Sentry**
   - View error trends
   - Identify error patterns
   - Check affected users

2. **Check logs**
   ```bash
   netlify functions:log --tail
   ```

3. **Common causes**
   - Database connection pool exhausted
   - External API rate limits
   - Memory leaks in functions
   - Malformed requests

4. **Mitigations**
   - Increase rate limits
   - Scale database connections
   - Restart functions
   - Deploy hotfix

### Performance Degradation

1. **Check metrics**
   - Response times in Datadog
   - Database query performance
   - Function cold starts
   - Cache hit rates

2. **Quick wins**
   - Increase function memory
   - Warm up cold functions
   - Clear stale cache
   - Optimize slow queries

3. **Long-term fixes**
   - Implement caching
   - Optimize database indexes
   - Use CDN for assets
   - Code splitting

### Database Issues

1. **Connection errors**
   ```bash
   # Test connection
   psql $DATABASE_URL -c "SELECT 1;"
   
   # Check connection pool
   psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"
   ```

2. **Slow queries**
   ```sql
   -- Find slow queries
   SELECT query, mean_exec_time, calls 
   FROM pg_stat_statements 
   ORDER BY mean_exec_time DESC 
   LIMIT 10;
   ```

3. **Maintenance**
   ```sql
   -- Vacuum and analyze
   VACUUM ANALYZE;
   
   -- Reindex
   REINDEX DATABASE staycool_production;
   ```

### External Service Failures

#### Google Maps API
- Check API key validity
- Verify quota limits
- Use cached data fallback
- Show degraded experience

#### GoHighLevel API
- Check authentication
- Verify webhook endpoints
- Queue failed requests
- Manual sync if needed

#### Email Service
- Check API key
- Verify sending limits
- Use backup provider
- Queue for retry

## Monitoring Queries

### Key Metrics

```javascript
// Datadog queries
// Request rate
sum:trace.express.request.hits{service:staycool-api}.as_rate()

// Error rate
sum:trace.express.request.errors{service:staycool-api}.as_rate()

// Response time (p95)
avg:trace.express.request.duration{service:staycool-api} by {resource_name}.rollup(avg, 300)

// Active users
sum:staycool.users.active{*}

// Appointments created
sum:staycool.appointments.created{*}.as_count()
```

### Health Checks

```bash
# All systems
curl https://staycoolairco.nl/api/health | jq '.'

# Specific function
curl https://staycoolairco.nl/api/appointments/availability

# Database health
curl https://staycoolairco.nl/api/health | jq '.checks.database'
```

## Backup & Recovery

### Database Backup

Automated daily at 3 AM CET via Supabase

Manual backup:
```bash
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Recovery Procedures

1. **Database recovery**
   ```bash
   # Restore from backup
   psql $DATABASE_URL < backup_file.sql
   ```

2. **Redis recovery**
   - Redis is cache only
   - Safe to flush and rebuild

3. **Function recovery**
   - Redeploy from Git
   - Environment vars from Netlify

## Security Procedures

### Incident Response

1. **Suspected breach**
   - Rotate all API keys immediately
   - Review access logs
   - Enable additional logging
   - Notify security team

2. **API key rotation**
   ```bash
   # Generate new keys
   openssl rand -base64 32
   
   # Update in Netlify
   netlify env:set JWT_SECRET "new-secret"
   netlify deploy --prod
   ```

3. **Block suspicious IPs**
   - Add to Netlify Edge rules
   - Update WAF rules
   - Monitor for patterns

### Regular Security Tasks

- **Daily**: Review security alerts
- **Weekly**: Check failed login attempts
- **Monthly**: Rotate API keys
- **Quarterly**: Security audit

## Performance Optimization

### Quick Optimizations

1. **Enable caching headers**
   ```toml
   [[headers]]
     for = "/_next/static/*"
     [headers.values]
       Cache-Control = "public, max-age=31536000, immutable"
   ```

2. **Optimize images**
   - Use Next.js Image component
   - Enable WebP format
   - Lazy load below fold

3. **Database indexes**
   ```sql
   -- Check missing indexes
   SELECT schemaname, tablename, attname, n_distinct, correlation
   FROM pg_stats
   WHERE schemaname = 'public'
   ORDER BY n_distinct DESC;
   ```

### Load Testing

```bash
# Simple load test
ab -n 1000 -c 10 https://staycoolairco.nl/api/health

# Complex scenarios
k6 run load-test.js
```

## Useful Commands

### Netlify CLI

```bash
# Deploy
netlify deploy --prod
netlify deploy --alias staging

# Logs
netlify functions:log <function-name> --tail
netlify logs:deploy

# Environment
netlify env:list
netlify env:set KEY value
netlify env:unset KEY

# Debug
netlify status
netlify sites:list
```

### Database

```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity;

-- Table sizes
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

-- Lock monitoring
SELECT * FROM pg_locks WHERE NOT granted;
```

### Redis

```bash
# Connect
redis-cli -h $REDIS_HOST -p 6379 -a $REDIS_PASSWORD

# Monitor
MONITOR

# Info
INFO memory
INFO stats

# Flush
FLUSHDB  # Current database
FLUSHALL # All databases
```

---

Last Updated: 2025-08-01
On-Call Schedule: https://staycoolairco.pagerduty.com