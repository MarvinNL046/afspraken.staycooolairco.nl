# Environment Variable Cleanup Guide

## Problem
The deployment is failing with: "Your environment variables exceed the 4KB limit imposed by AWS Lambda"

## Solution: Remove Duplicate VITE_* Variables

The following VITE_* variables should be removed from Netlify as they are duplicates or unused in a Next.js project:

### Variables to Remove:
1. **VITE_GOOGLE_API_KEY** - Remove (use GOOGLE_MAPS_API_KEY instead)
2. **VITE_GOOGLE_CALENDAR_ID** - Remove (use GOOGLE_CALENDAR_ID instead)
3. **VITE_GOOGLE_CLIENT_ID** - Remove (not used in Next.js)
4. **VITE_GOOGLE_CLIENT_SECRET** - Remove (not used in Next.js)
5. **VITE_GOOGLE_MAPS_API_KEY** - Remove (use NEXT_PUBLIC_GOOGLE_MAPS_API_KEY instead)
6. **VITE_GOOGLE_MAPS_SIGNING_SECRET** - Remove (not used)
7. **VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL** - Remove (use GOOGLE_SERVICE_ACCOUNT_EMAIL instead)
8. **VITE_GOOGLE_SERVICE_ACCOUNT_ID** - Remove (not used)
9. **VITE_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY** - Remove (included in GOOGLE_CALENDAR_CREDENTIALS)
10. **VITE_RECAPTCHA_SITE_KEY** - Remove (not used)

### How to Remove:
```bash
# Remove each VITE variable
netlify env:unset VITE_GOOGLE_API_KEY
netlify env:unset VITE_GOOGLE_CALENDAR_ID
netlify env:unset VITE_GOOGLE_CLIENT_ID
netlify env:unset VITE_GOOGLE_CLIENT_SECRET
netlify env:unset VITE_GOOGLE_MAPS_API_KEY
netlify env:unset VITE_GOOGLE_MAPS_SIGNING_SECRET
netlify env:unset VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL
netlify env:unset VITE_GOOGLE_SERVICE_ACCOUNT_ID
netlify env:unset VITE_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
netlify env:unset VITE_RECAPTCHA_SITE_KEY
```

### Alternative: Store Large Credentials as Files

For the `GOOGLE_CALENDAR_CREDENTIALS` which is very large (1889 bytes), consider:

1. Store it as a build-time file instead of environment variable
2. Use Netlify's File-based configuration for sensitive data
3. Or split it into smaller parts

## After Cleanup

After removing these variables, trigger a new deployment:
```bash
git commit --allow-empty -m "Trigger deployment after env cleanup"
git push
```