# Sales Team Calendar Color Filtering

## 🚨 CRITICAL BUSINESS RULE

This appointment system is designed **EXCLUSIVELY** for the sales team. The Google Calendar contains appointments for multiple teams, each identified by different colors. 

### Sales Team Configuration

- **Team**: Limburg Sales Team
- **Calendar Color**: Yellow
- **Color ID**: 5
- **Service Area**: Limburg Province

### Why This Matters

Without proper color filtering, the system would:
1. Show time slots as unavailable when they're occupied by other teams
2. Prevent sales team bookings during times when other teams have appointments
3. Display incorrect availability to customers
4. Create scheduling conflicts between teams

### Implementation Details

#### 1. Calendar Event Filtering

All Google Calendar API calls filter events by color:

```typescript
// lib/google-calendar.ts
export async function getSalesTeamCalendarEvents(startDate: Date, endDate: Date) {
  const SALES_TEAM_COLOR_ID = '5'
  return getCalendarEvents(startDate, endDate, SALES_TEAM_COLOR_ID)
}
```

#### 2. Database Query Filtering

All appointment queries include color filtering:

```typescript
// lib/availability.ts
const appointments = await prisma.afspraak.findMany({
  where: {
    datum: requestedDate,
    status: { notIn: ['geannuleerd', 'niet_verschenen'] },
    colorId: SALES_TEAM_COLOR_ID // Only sales team appointments
  }
})
```

#### 3. Appointment Creation

All new appointments are created with the sales team color:

```typescript
// create-appointment.ts
const appointment = await prisma.afspraak.create({
  data: {
    // ... other fields
    colorId: '5', // Always yellow for sales team
  }
})
```

#### 4. Route Clustering

Route optimization only considers sales team appointments:

```typescript
// cluster-routes.ts
const appointments = await prisma.afspraak.findMany({
  where: {
    // ... other conditions
    colorId: '5', // Only cluster sales team appointments
  }
})
```

### Testing Considerations

When testing availability:
1. Create test appointments with different colors in Google Calendar
2. Verify that only yellow (ID: 5) appointments affect availability
3. Confirm that other team appointments are completely ignored

### Common Issues

**Issue**: Time slots showing as unavailable incorrectly  
**Cause**: Calendar events without color filtering  
**Solution**: Ensure all calendar queries use `getSalesTeamCalendarEvents()`

**Issue**: Appointments created with wrong color  
**Cause**: Missing colorId in creation  
**Solution**: Always set `colorId: '5'` when creating appointments

### Future Considerations

If expanding to multiple teams:
1. Add team selection to the booking interface
2. Create separate availability checkers per team color
3. Implement team-based access controls
4. Consider separate calendars per team instead of color coding

### Environment Variables

No additional environment variables needed. The color ID is hard-coded as a business rule to prevent accidental misconfiguration.

### Monitoring

Monitor for:
- Appointments created without colorId = '5'
- Calendar events fetched without color filtering
- Availability checks that don't filter by color

### SQL Queries for Verification

```sql
-- Check for appointments without proper color
SELECT COUNT(*) as wrong_color_count
FROM afspraken
WHERE status IN ('gepland', 'bevestigd')
AND (colorId IS NULL OR colorId != '5');

-- Verify all future appointments have correct color
SELECT datum, tijd, colorId, beschrijving
FROM afspraken
WHERE datum >= CURRENT_DATE
AND status IN ('gepland', 'bevestigd')
ORDER BY datum, tijd;
```