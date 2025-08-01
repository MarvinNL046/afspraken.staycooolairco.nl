# Custom Domain Setup Guide for StayCool Airco

This guide walks through setting up the custom domain `staycoolairco.nl` with Netlify, including SSL configuration and DNS settings.

## Prerequisites

- Domain registered and DNS access
- Netlify account with site deployed
- Access to domain registrar's DNS settings

## Step 1: Add Custom Domain in Netlify

1. Go to your Netlify site dashboard
2. Navigate to **Domain settings** → **Custom domains**
3. Click **Add custom domain**
4. Enter `staycoolairco.nl` (without www)
5. Click **Verify** → **Add domain**

## Step 2: Configure DNS Records

### Option A: Using Netlify DNS (Recommended)

1. In Netlify, go to **Domains** → **Add or register domain**
2. Enter `staycoolairco.nl`
3. Choose **Add domain** → **Continue**
4. Update nameservers at your registrar to:
   ```
   dns1.p01.nsone.net
   dns2.p01.nsone.net
   dns3.p01.nsone.net
   dns4.p01.nsone.net
   ```

### Option B: Using External DNS

Add these records to your DNS provider:

#### A Records (for apex domain)
```
Type: A
Name: @ (or blank)
Value: 75.2.60.5
TTL: 300
```

#### CNAME Record (for www)
```
Type: CNAME
Name: www
Value: [your-site-name].netlify.app
TTL: 300
```

#### Additional Records for Services
```
# Email (if using Google Workspace)
Type: MX
Name: @
Priority: 1
Value: aspmx.l.google.com
TTL: 3600

Type: MX
Name: @
Priority: 5
Value: alt1.aspmx.l.google.com
TTL: 3600

Type: MX
Name: @
Priority: 5
Value: alt2.aspmx.l.google.com
TTL: 3600

# SPF Record
Type: TXT
Name: @
Value: "v=spf1 include:_spf.google.com ~all"
TTL: 3600

# DKIM (if configured)
Type: TXT
Name: google._domainkey
Value: [Your DKIM key from Google Workspace]
TTL: 3600
```

## Step 3: SSL Certificate Configuration

### Automatic SSL (Let's Encrypt)

1. Once DNS is configured, go to **Domain settings** → **HTTPS**
2. Click **Verify DNS configuration**
3. Once verified, click **Provision certificate**
4. Certificate will be auto-renewed every 90 days

### SSL Settings in Netlify

Ensure these settings are enabled:
- ✅ Force HTTPS
- ✅ Automatic certificate renewal
- ✅ Include subdomains

## Step 4: Verify Configuration

### DNS Propagation Check
```bash
# Check A record
dig staycoolairco.nl A

# Check CNAME
dig www.staycoolairco.nl CNAME

# Check SSL certificate
openssl s_client -connect staycoolairco.nl:443 -servername staycoolairco.nl
```

### Online Tools
- DNS Checker: https://dnschecker.org/
- SSL Test: https://www.ssllabs.com/ssltest/
- Security Headers: https://securityheaders.com/

## Step 5: Configure Redirects

The `_redirects` file handles:
- www → non-www redirect
- HTTP → HTTPS redirect
- API routing
- Legacy URL redirects

```
# Primary redirects (already configured)
https://www.staycoolairco.nl/* https://staycoolairco.nl/:splat 301!
http://staycoolairco.nl/* https://staycoolairco.nl/:splat 301!
http://www.staycoolairco.nl/* https://staycoolairco.nl/:splat 301!
```

## Step 6: Update Application Configuration

### Environment Variables
Update in Netlify dashboard:
```
NEXT_PUBLIC_APP_URL=https://staycoolairco.nl
NEXT_PUBLIC_API_URL=https://staycoolairco.nl/api
CORS_ALLOWED_ORIGINS=https://staycoolairco.nl,https://www.staycoolairco.nl
FRONTEND_URL=https://staycoolairco.nl
```

### Content Security Policy
Already configured in `netlify.toml` to allow:
- Scripts from Google Maps
- Styles from Google Fonts
- Images from various sources
- API connections

## Step 7: Post-Deployment Checklist

- [ ] Verify domain resolves correctly
- [ ] Check www redirect works
- [ ] Verify HTTPS is forced
- [ ] Test all API endpoints
- [ ] Check SSL certificate grade (A+ expected)
- [ ] Verify security headers
- [ ] Test form submissions
- [ ] Check Google Maps integration
- [ ] Verify email delivery (if applicable)
- [ ] Monitor error tracking (Sentry)

## Troubleshooting

### DNS Not Resolving
- Wait up to 48 hours for propagation
- Clear local DNS cache: `sudo dscacheutil -flushcache` (macOS)
- Try different DNS servers (8.8.8.8, 1.1.1.1)

### SSL Certificate Issues
- Ensure CAA records don't block Let's Encrypt
- Check for conflicting AAAA records
- Verify domain ownership in Netlify

### Redirect Loops
- Check _redirects file for circular redirects
- Ensure Cloudflare SSL mode is "Full" if using Cloudflare
- Disable any redirects at registrar level

### CORS Issues
- Verify allowed origins in environment variables
- Check browser console for specific CORS errors
- Ensure API routes use proper headers

## Monitoring

### Uptime Monitoring
Set up monitoring for:
- https://staycoolairco.nl (expecting 200)
- https://staycoolairco.nl/api/health (expecting 200)
- https://www.staycoolairco.nl (expecting 301)

### SSL Monitoring
- Set up expiry alerts (though auto-renewal handles this)
- Monitor certificate transparency logs
- Regular security header audits

## Security Considerations

1. **HSTS Preloading**: After stable deployment, consider HSTS preloading
2. **CAA Records**: Add CAA records to limit certificate authorities
3. **DNSSEC**: Enable if supported by registrar
4. **Security.txt**: Add security contact information

Example CAA record:
```
Type: CAA
Name: @
Value: 0 issue "letsencrypt.org"
```

## Maintenance

### Regular Tasks
- Monthly: Check SSL Labs rating
- Quarterly: Review security headers
- Annually: Renew domain registration
- Ongoing: Monitor DNS changes

### Emergency Procedures
If domain is compromised:
1. Change registrar password immediately
2. Enable 2FA on registrar account
3. Review all DNS records
4. Check for unauthorized redirects
5. Contact Netlify support if needed

---

For additional help, contact:
- Netlify Support: https://www.netlify.com/support/
- Domain Registrar Support: [Your registrar's support]