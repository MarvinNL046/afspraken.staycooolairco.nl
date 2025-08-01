-- Verification script for sales team color filtering
-- Run this script to ensure the system is correctly filtering by color

-- 1. Check appointments without proper color assignment
SELECT 
    'Appointments without sales team color' as check_type,
    COUNT(*) as count,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ PASS: All appointments have correct color'
        ELSE '❌ FAIL: Found appointments without yellow color (ID: 5)'
    END as status
FROM afspraken
WHERE datum >= CURRENT_DATE
AND status IN ('gepland', 'bevestigd')
AND (color_id IS NULL OR color_id != '5');

-- 2. Show color distribution of all appointments
SELECT 
    'Color distribution of appointments' as check_type,
    color_id,
    COUNT(*) as appointment_count,
    CASE color_id
        WHEN '1' THEN 'Lavender'
        WHEN '2' THEN 'Sage'
        WHEN '3' THEN 'Grape'
        WHEN '4' THEN 'Flamingo'
        WHEN '5' THEN 'Banana/Yellow (SALES TEAM)'
        WHEN '6' THEN 'Tangerine'
        WHEN '7' THEN 'Peacock'
        WHEN '8' THEN 'Graphite'
        WHEN '9' THEN 'Blueberry'
        WHEN '10' THEN 'Basil'
        WHEN '11' THEN 'Tomato'
        ELSE 'No color assigned'
    END as color_name
FROM afspraken
WHERE status IN ('gepland', 'bevestigd')
GROUP BY color_id
ORDER BY appointment_count DESC;

-- 3. Find any appointments that might block sales team slots
WITH potential_conflicts AS (
    SELECT 
        a1.id as sales_appointment_id,
        a1.datum as sales_date,
        a1.tijd as sales_time,
        a2.id as other_appointment_id,
        a2.datum as other_date,
        a2.tijd as other_time,
        a2.color_id as other_color
    FROM afspraken a1
    INNER JOIN afspraken a2 
        ON a1.datum = a2.datum 
        AND a1.tijd = a2.tijd
        AND a1.id != a2.id
    WHERE a1.color_id = '5'  -- Sales team
    AND a2.color_id != '5'    -- Other teams
    AND a1.status IN ('gepland', 'bevestigd')
    AND a2.status IN ('gepland', 'bevestigd')
)
SELECT 
    'Time slot conflicts between teams' as check_type,
    COUNT(*) as conflict_count,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ PASS: No time conflicts between teams'
        ELSE '❌ FAIL: Found appointments at same time for different teams'
    END as status
FROM potential_conflicts;

-- 4. Verify route clusters only contain sales team appointments
SELECT 
    'Route clusters color consistency' as check_type,
    rc.id as cluster_id,
    rc.datum as cluster_date,
    COUNT(DISTINCT a.color_id) as unique_colors,
    STRING_AGG(DISTINCT a.color_id, ', ') as colors_in_cluster,
    CASE 
        WHEN COUNT(DISTINCT a.color_id) = 1 AND MAX(a.color_id) = '5' THEN '✅ PASS'
        ELSE '❌ FAIL: Mixed colors in cluster'
    END as status
FROM route_clusters rc
INNER JOIN afspraken a ON a.route_cluster_id = rc.id
WHERE a.status IN ('gepland', 'bevestigd')
GROUP BY rc.id, rc.datum
ORDER BY rc.datum DESC;

-- 5. Show sample of recent appointments with their colors
SELECT 
    'Recent appointments sample' as check_type,
    datum,
    tijd,
    color_id,
    service_type,
    status,
    SUBSTRING(beschrijving, 1, 50) as description_preview,
    created_at
FROM afspraken
WHERE datum >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY datum DESC, tijd DESC
LIMIT 10;

-- 6. Summary dashboard
WITH summary AS (
    SELECT 
        COUNT(*) FILTER (WHERE color_id = '5') as sales_team_count,
        COUNT(*) FILTER (WHERE color_id != '5' OR color_id IS NULL) as other_team_count,
        COUNT(*) as total_count
    FROM afspraken
    WHERE datum >= CURRENT_DATE
    AND status IN ('gepland', 'bevestigd')
)
SELECT 
    'System color filtering summary' as check_type,
    sales_team_count,
    other_team_count,
    total_count,
    ROUND(100.0 * sales_team_count / NULLIF(total_count, 0), 2) as sales_team_percentage,
    CASE 
        WHEN other_team_count = 0 THEN '✅ PERFECT: Only sales team appointments in system'
        WHEN sales_team_count > 0 THEN '⚠️  WARNING: Mixed team appointments detected'
        ELSE '❌ CRITICAL: No sales team appointments found'
    END as overall_status
FROM summary;

-- 7. Instructions for manual calendar verification
SELECT 
    'Manual verification steps' as check_type,
    '1. Open Google Calendar' as step_1,
    '2. Look for appointments with different colors' as step_2,
    '3. Yellow appointments = Sales team (should appear as available)' as step_3,
    '4. Other colors = Other teams (should NOT affect availability)' as step_4,
    '5. Test booking a slot where another team has appointment' as step_5;