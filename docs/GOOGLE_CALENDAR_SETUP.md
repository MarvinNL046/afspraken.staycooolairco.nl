# Google Calendar Setup voor StayCool

## 1. Service Account Aanmaken

1. Ga naar [Google Cloud Console](https://console.cloud.google.com/)
2. Maak een nieuw project of selecteer bestaand project
3. Ga naar "APIs & Services" → "Credentials"
4. Klik "Create Credentials" → "Service Account"
5. Vul in:
   - Naam: `staycool-calendar-service`
   - ID: (wordt automatisch gegenereerd)
6. Klik "Create and Continue"
7. Skip de rol toewijzing (niet nodig voor Calendar API)
8. Klik "Done"

## 2. Service Account Key Genereren

1. Klik op je nieuwe service account
2. Ga naar "Keys" tab
3. Klik "Add Key" → "Create new key"
4. Selecteer "JSON"
5. Download de JSON key file - **BEWAAR DEZE VEILIG!**

## 3. Google Calendar API Activeren

1. Ga naar "APIs & Services" → "Library"
2. Zoek "Google Calendar API"
3. Klik erop en dan "Enable"

## 4. Calendar Delen met Service Account

1. Ga naar [Google Calendar](https://calendar.google.com)
2. Ga naar instellingen van je werk-agenda
3. Onder "Delen met specifieke personen", klik "Persoon toevoegen"
4. Voeg het service account email toe (staat in je JSON file als `client_email`)
   - Bijvoorbeeld: `staycool-calendar-service@project-id.iam.gserviceaccount.com`
5. Geef "Wijzigingen aanbrengen in gebeurtenissen" rechten
6. Klik "Verzenden"

## 5. Calendar ID Vinden

1. In Google Calendar, ga naar agenda instellingen
2. Scroll naar "Agenda-ID" sectie
3. Kopieer de ID (bijvoorbeeld: `info@staycoolairco.nl` of `random-id@group.calendar.google.com`)

## 6. Toevoegen aan Netlify

### Optie A: Via Netlify CLI
```bash
# Voeg de volledige JSON inhoud als environment variable
netlify env:set GOOGLE_CALENDAR_CREDENTIALS '{"type":"service_acc...","project_id":"...volledig JSON inhoud...}'

# Voeg Calendar ID toe
netlify env:set GOOGLE_CALENDAR_ID "info@staycoolairco.nl"
```

### Optie B: Via Netlify Dashboard
1. Ga naar je site in Netlify
2. Site Configuration → Environment Variables
3. Voeg toe:
   - `GOOGLE_CALENDAR_CREDENTIALS`: Plak de volledige JSON inhoud
   - `GOOGLE_CALENDAR_ID`: Je calendar ID

## 7. Testen

Test of alles werkt door naar deze URL te gaan:
```
https://afspraken.staycoolairco.nl/.netlify/functions/check-availability?date=2025-08-04
```

Je zou beschikbare tijdslots moeten zien!