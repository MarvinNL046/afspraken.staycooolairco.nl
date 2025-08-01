# Netlify Plugins - Waarom ze belangrijk zijn

## 1. @netlify/plugin-nextjs ✅ (Essentieel)
**Waarom**: Dit is DE belangrijkste plugin voor Next.js apps op Netlify
- Optimaliseert Next.js builds
- Configureert Image Optimization
- Handelt ISR (Incremental Static Regeneration)
- Zet API routes om naar Netlify Functions

## 2. @netlify/plugin-sitemap 🗺️ (SEO)
**Waarom**: Automatische sitemap generatie voor betere Google indexering
- Genereert sitemap.xml automatisch
- Helpt Google je pagina's te vinden
- Verbetert SEO ranking
- **Fix**: Added `failPlugin = false` zodat build niet faalt als er problemen zijn

## 3. @netlify/plugin-lighthouse ⚡ (Performance)
**Waarom**: Monitort website performance
- Meet laadtijden
- Controleert accessibility
- SEO checks
- **Probleem**: Kan build vertragen, daarom tijdelijk uitgeschakeld

## 4. netlify-plugin-cache-nextjs 💾 (Build Speed)
**Waarom**: Versnelt builds door caching
- Cache Next.js build artifacts
- Snellere deploy times
- **Probleem**: Kan conflicts geven met Next.js 15, daarom uitgeschakeld

## 5. @sentry/netlify-build-plugin 🚨 (Error Tracking)
**Waarom**: Productie error monitoring
- Vangt JavaScript errors
- Performance monitoring
- **Probleem**: Vereist Sentry account setup, daarom uitgeschakeld

## Scheduled Functions (Tijdelijk uitgeschakeld)

### health-check (Elke 5 minuten)
- Controleert of de app nog werkt
- Stuurt alerts bij problemen

### cleanup-expired-tokens (Elke 6 uur)
- Ruimt verlopen JWT tokens op
- Houdt database schoon

### sync-appointments (Elk uur)
- Synchroniseert met Google Calendar
- Update appointment statussen

### backup-database (Dagelijks 3 AM)
- Maakt database backups
- Belangrijk voor data veiligheid

### generate-reports (Wekelijks)
- Genereert business reports
- Appointment statistics

## Aanbeveling

Voor nu focus op een werkende deployment met:
1. ✅ @netlify/plugin-nextjs (essentieel)
2. ✅ @netlify/plugin-sitemap (SEO)

Later toevoegen als de basis werkt:
3. ⏳ Performance monitoring (Lighthouse)
4. ⏳ Error tracking (Sentry)
5. ⏳ Scheduled functions voor automation

Dit is een iteratieve aanpak - eerst werkend krijgen, dan optimaliseren!