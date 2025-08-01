# Netlify CLI - Build Logs Bekijken

## Beschikbare Commando's voor Logs

### 1. **Live Function Logs Streamen**
```bash
netlify logs
```
Dit toont real-time logs van je Netlify Functions (serverless functions).

### 2. **Specifieke Function Logs**
```bash
netlify logs:function function-name
```

### 3. **Build Status Bekijken**
```bash
netlify status
```
Toont de huidige deploy status en project info.

### 4. **Wachten op Deploy**
```bash
netlify watch
```
Wacht tot de huidige deployment klaar is en toont de status.

### 5. **Open Netlify Dashboard**
```bash
netlify open
```
Opent je browser direct naar het Netlify dashboard waar je:
- Build logs kunt zien
- Deploy history kunt bekijken
- Function logs kunt monitoren

### 6. **Open Specifieke Secties**
```bash
netlify open:admin    # Open project dashboard
netlify open:site     # Open live site
```

## Build Logs via Dashboard

Voor uitgebreide build logs:
1. Ga naar https://app.netlify.com/
2. Selecteer je project
3. Klik op "Deploys" tab
4. Klik op een specifieke deploy voor details

## Handige Tips

### Check Laatste Deploy
```bash
# Combineer commando's voor overzicht
netlify status && netlify watch
```

### Monitor Functions
```bash
# Real-time function logs
netlify logs --tail
```

### Debug Build Problemen
```bash
# Lokaal builden om problemen te vinden
netlify build
```

## Waarom geen directe build logs via CLI?

Netlify CLI focust vooral op:
- Function logs (runtime)
- Deploy status
- Site management

Voor gedetailleerde **build logs** moet je:
- Het dashboard gebruiken
- Of de Netlify API direct aanroepen

Dit is een bewuste keuze van Netlify omdat build logs vaak erg groot zijn en beter weergegeven worden in de web interface.