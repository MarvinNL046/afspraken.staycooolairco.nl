# Netlify Environment Variables Setup Guide

## ✅ Already Configured Variables

The following environment variables have been successfully configured via Netlify CLI:

### Core Application
- ✅ `NODE_ENV` = "production"
- ✅ `NEXT_PUBLIC_ENV` = "production"
- ✅ `NEXT_PUBLIC_APP_URL` = "https://afspraken.staycoolairco.nl"
- ✅ `NEXT_PUBLIC_API_URL` = "https://afspraken.staycoolairco.nl"

### Authentication & Security
- ✅ `JWT_SECRET` = [Generated 64-char secret]
- ✅ `JWT_REFRESH_SECRET` = [Generated 64-char secret]
- ✅ `ENCRYPTION_KEY` = [Generated 32-char hex key]
- ✅ `INTERNAL_API_KEY` = [Generated 64-char hex key]

### Google APIs
- ✅ `GOOGLE_MAPS_API_KEY` = [Configured - API key stored securely in Netlify]
- ✅ `GOOGLE_CALENDAR_ID` = "info@staycoolairco.nl"
- ✅ `GOOGLE_SERVICE_ACCOUNT_EMAIL` = [Configured - Service account email stored in Netlify]
- ✅ `GOOGLE_SERVICE_ACCOUNT_KEY` = [Configured - Base64 encoded service account JSON stored in Netlify]

### Security Configuration
- ✅ `CORS_ALLOWED_ORIGINS` = "https://afspraken.staycoolairco.nl,https://app.netlify.com"
- ✅ `FRONTEND_URL` = "https://afspraken.staycoolairco.nl"

## ❌ Required Variables Still Missing

### 1. DATABASE_URL (CRITICAL)
You need to set up a PostgreSQL database. Here are your options:

#### Option A: Supabase (Recommended - Free Tier Available)
1. Go to https://supabase.com/
2. Create a new project "staycool-appointments"
3. Get your connection string from Project Settings > Database
4. Set the environment variable:
```bash
netlify env:set DATABASE_URL "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].supabase.co:5432/postgres"
```

#### Option B: Neon (Alternative - Also Free)
1. Go to https://neon.tech/
2. Create a new project
3. Get your connection string
4. Set the environment variable:
```bash
netlify env:set DATABASE_URL "postgresql://[username]:[password]@[host]/[database]?sslmode=require"
```

### 2. GoHighLevel Integration (Optional for MVP)
If you have GoHighLevel access:
```bash
netlify env:set GOHIGHLEVEL_API_KEY "your-ghl-api-key"
netlify env:set GOHIGHLEVEL_LOCATION_ID "your-location-id"
netlify env:set GOHIGHLEVEL_WEBHOOK_SECRET "generate-a-random-secret"
```

## 🔧 Optional but Recommended Variables

### Redis Cache (For Performance)
Use Upstash Redis (free tier available):
```bash
netlify env:set REDIS_URL "redis://default:[password]@[endpoint]:6379"
```

### Error Monitoring
Sentry (free tier available):
```bash
netlify env:set SENTRY_DSN "your-sentry-dsn"
```

### Email Service
For sending emails (if not using GoHighLevel):
```bash
netlify env:set EMAIL_SERVICE_API_KEY "your-email-api-key"
```

### Rate Limiting
```bash
netlify env:set RATE_LIMIT_WINDOW_MS "60000"
netlify env:set RATE_LIMIT_MAX_REQUESTS "10"
```

## 📋 Next Steps

1. **Set up PostgreSQL Database** (REQUIRED)
   - Choose Supabase or Neon
   - Create your project
   - Add the DATABASE_URL to Netlify

2. **Run Database Migrations**
   After setting DATABASE_URL:
   ```bash
   npx prisma migrate deploy
   ```

3. **Test the Deployment**
   ```bash
   netlify deploy --prod
   ```

4. **Verify Environment Variables**
   ```bash
   netlify env:list
   ```

5. **Check Application Health**
   Visit: https://afspraken.staycoolairco.nl/api/health

## 🚀 Quick Database Setup with Supabase

1. Visit https://app.supabase.com/sign-up
2. Create account (GitHub signin recommended)
3. Click "New project"
4. Fill in:
   - Organization: StayCool (or your org name)
   - Project name: staycool-appointments
   - Database Password: [Generate strong password and save it!]
   - Region: Europe (Frankfurt) - closest to Netherlands
5. Wait for project to be created (~2 minutes)
6. Go to Settings > Database
7. Copy the "Connection string" (URI mode)
8. Replace [YOUR-PASSWORD] with your actual password
9. Run:
   ```bash
   netlify env:set DATABASE_URL "your-connection-string-here"
   ```

## 🔍 Validation

After setting all required variables, run the validation script locally:
```bash
# First, pull the environment variables locally
netlify env:pull .env

# Then run validation
node scripts/validate-env.js
```

This will show you which variables are properly configured and which might still be missing.