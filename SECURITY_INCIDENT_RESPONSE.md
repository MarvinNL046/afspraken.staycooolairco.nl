# 🚨 SECURITY INCIDENT RESPONSE - EXPOSED SECRETS

## Incident Summary
- **Date**: August 1, 2025
- **Severity**: HIGH
- **Type**: Exposed credentials in git history
- **Status**: Partially Resolved

## Exposed Secrets (NOW REMOVED FROM REPOSITORY)
1. **Google Maps API Key**: AIzaSyDYx9_2AvXXQ2r_Ir5hxm0JZFNGgVDV7Oo
2. **Google Service Account Email**: staycool-calendar-service@cogent-tract-467515-e5.iam.gserviceaccount.com
3. **Supabase Service Role JWT**: (if any were exposed)
4. **Database passwords**: (placeholders only, no actual passwords found)

## ✅ Completed Actions
1. Created backup of repository before cleanup
2. Removed exposed secrets from current files
3. Used git filter-branch to remove secrets from entire git history
4. Force pushed cleaned repository to GitHub
5. Verified secrets are no longer in repository history

## 🚨 IMMEDIATE ACTIONS REQUIRED

### 1. Revoke Exposed Google API Key (CRITICAL - DO THIS NOW!)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to "APIs & Services" → "Credentials"
3. Find the exposed API key: `AIzaSyDYx9_2AvXXQ2r_Ir5hxm0JZFNGgVDV7Oo`
4. Click on it and then click "DELETE" or "REVOKE"
5. Confirm the deletion

### 2. Create New Google Maps API Key
1. In Google Cloud Console, click "CREATE CREDENTIALS" → "API key"
2. Name it: "StayCool Afspraken Maps API - Production"
3. Click "RESTRICT KEY" and configure:
   - **Application restrictions**: HTTP referrers
   - Add these referrers:
     - `https://afspraken.staycoolairco.nl/*`
     - `https://*.netlify.app/*` (for preview deployments)
   - **API restrictions**: Restrict to these APIs only:
     - Maps JavaScript API
     - Places API
     - Geocoding API
4. Save the new API key

### 3. Update Netlify Environment Variables
```bash
# Update with your new API key
netlify env:set GOOGLE_MAPS_API_KEY "your-new-api-key-here"

# Verify it's set
netlify env:list | grep GOOGLE
```

### 4. Rotate Service Account (If Compromised)
1. Go to Google Cloud Console → IAM & Admin → Service Accounts
2. Find: staycool-calendar-service@cogent-tract-467515-e5.iam.gserviceaccount.com
3. Create new key or rotate existing one
4. Update in Netlify:
```bash
# Encode the new service account JSON
base64 -w 0 < new-service-account-key.json

# Set in Netlify
netlify env:set GOOGLE_SERVICE_ACCOUNT_KEY "base64-encoded-string"
```

### 5. Monitor for Unauthorized Usage
1. Check Google Cloud Console for any unexpected API usage
2. Set up billing alerts if not already configured
3. Review access logs for the past 24 hours

### 6. Security Audit Checklist
- [ ] All exposed API keys revoked
- [ ] New API keys generated with proper restrictions
- [ ] Environment variables updated in Netlify
- [ ] Application tested with new credentials
- [ ] Billing alerts configured
- [ ] Team notified of the incident
- [ ] GitGuardian alerts resolved

## Prevention Measures for Future

### 1. Never Commit Secrets
- Always use environment variables
- Use `.env.example` files with placeholders
- Add pre-commit hooks to detect secrets

### 2. Use Secret Scanning
```bash
# Install gitleaks
brew install gitleaks

# Scan repository
gitleaks detect --source . -v

# Add as pre-commit hook
echo 'gitleaks protect --verbose --redact --staged' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### 3. Documentation Best Practices
- Use placeholders like `[YOUR_API_KEY]` in documentation
- Never use real credentials in examples
- Store sensitive documentation separately from code

### 4. Regular Security Audits
- Scan repositories monthly for exposed secrets
- Rotate credentials quarterly
- Review access logs regularly

## Additional Notes

### Repository Cleanup Details
- Used `git filter-branch` to remove secrets from history
- Removed files: DEPLOYMENT_STATUS.md, DEPLOYMENT_READY.md, FINAL_DEPLOYMENT_STATUS.md
- Cleaned sensitive strings from remaining documentation files
- Force pushed to overwrite GitHub history

### Important Warnings
- Anyone who cloned the repository before cleanup still has the exposed secrets
- Cached versions may exist on GitHub, search engines, or third-party services
- The exposed API key may have been scraped by bots - revoke it immediately

## Contact Information
- **Security Lead**: [Your name]
- **Reported By**: GitGuardian
- **Repository**: https://github.com/MarvinNL046/afspraken.staycooolairco.nl

## Timeline
- Initial commit with secrets: August 1, 2025, 15:16 CET
- Detection by GitGuardian: [Time of detection]
- Cleanup started: August 1, 2025, [Current time]
- Repository cleaned: August 1, 2025, [Current time]
- **API Key Revocation**: PENDING - DO THIS NOW!