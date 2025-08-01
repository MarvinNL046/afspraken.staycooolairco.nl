# ⚠️ URGENT SECURITY ACTION REQUIRED

## Exposed Credentials Detected

GitGuardian has detected exposed credentials in this repository. The following actions are REQUIRED:

### 🔴 IMMEDIATE ACTIONS:

1. **Google Maps API Key** (AIzaSyDYx9_2AvXXQ2r_Ir5hxm0JZFNGgVDV7Oo)
   - Go to https://console.cloud.google.com/
   - Navigate to APIs & Services > Credentials
   - DELETE this key immediately
   - Create a NEW key with restrictions:
     - HTTP referrers: https://afspraken.staycoolairco.nl/*
     - API restrictions: Maps JavaScript API, Geocoding API, Places API only

2. **Supabase Credentials**
   - The service role JWT may have been exposed
   - Consider regenerating your Supabase JWT secret
   - Update all environment variables in Netlify

3. **Database Password**
   - Change your Supabase database password immediately
   - Update DATABASE_URL in Netlify with new password

### ✅ What Has Been Done:

1. Removed all sensitive files from git tracking
2. Updated .gitignore to prevent future exposure
3. Cleaned repository of exposed credentials
4. Created secure documentation without real credentials

### 📋 Prevention Measures:

1. **Never commit real credentials** - Use environment variables
2. **Use .env files** locally and add them to .gitignore
3. **Review files** before committing
4. **Use secret scanning** tools before pushing

### 🔐 Environment Variables

All credentials should be stored in Netlify environment variables:
```bash
netlify env:set VARIABLE_NAME "value"
```

Never hardcode credentials in:
- Documentation files
- Code files
- Configuration files
- Scripts

Remember: Once a secret is exposed on GitHub, it should be considered compromised and must be rotated!