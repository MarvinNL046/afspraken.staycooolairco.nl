-- Verification script for boundary validation setup

-- 1. Check service areas
SELECT 
    sa.id,
    sa.name,
    sa.province,
    sa.is_active,
    sa.calendar_color_id,
    sa.sales_person_name,
    COUNT(pcr.id) as postal_code_ranges
FROM service_areas sa
LEFT JOIN postal_code_ranges pcr ON sa.id = pcr.service_area_id
GROUP BY sa.id, sa.name, sa.province, sa.is_active, sa.calendar_color_id, sa.sales_person_name;

-- 2. View postal code ranges for Limburg
SELECT 
    pcr.start_code,
    pcr.end_code,
    CAST(pcr.end_code AS INTEGER) - CAST(pcr.start_code AS INTEGER) as range_size,
    array_length(pcr.excluded_codes, 1) as excluded_count
FROM postal_code_ranges pcr
JOIN service_areas sa ON pcr.service_area_id = sa.id
WHERE sa.name = 'Limburg'
ORDER BY pcr.start_code;

-- 3. Test postal code validation function
SELECT 
    postal_code,
    is_postal_code_in_service_area(
        postal_code, 
        (SELECT id FROM service_areas WHERE name = 'Limburg')
    ) as is_in_limburg
FROM (VALUES 
    ('6200'), -- Maastricht (should be true)
    ('5900'), -- Venlo (should be true)
    ('1000'), -- Amsterdam (should be false)
    ('5000'), -- Tilburg (should be false)
    ('6400'), -- Heerlen (should be true)
    ('6800')  -- Arnhem area (edge case)
) AS test_codes(postal_code);

-- 4. Check for appointments with boundary data
SELECT 
    COUNT(*) FILTER (WHERE color_id IS NOT NULL) as appointments_with_color,
    COUNT(*) FILTER (WHERE color_id = '5') as yellow_appointments,
    COUNT(*) as total_appointments
FROM afspraken
WHERE datum >= CURRENT_DATE;

-- 5. Analyze customer distribution by postal code
SELECT 
    SUBSTRING(postal_code FROM 1 FOR 2) as postal_prefix,
    COUNT(*) as customer_count,
    COUNT(*) FILTER (
        WHERE is_postal_code_in_service_area(
            postal_code, 
            (SELECT id FROM service_areas WHERE name = 'Limburg')
        )
    ) as in_service_area
FROM customers
GROUP BY postal_prefix
ORDER BY customer_count DESC
LIMIT 20;

-- 6. Find edge case postal codes (might need manual verification)
WITH limburg_area AS (
    SELECT id FROM service_areas WHERE name = 'Limburg'
)
SELECT DISTINCT
    c.postal_code,
    c.city,
    CASE 
        WHEN is_postal_code_in_service_area(c.postal_code, la.id) 
        THEN 'In Service Area'
        ELSE 'Outside Service Area'
    END as status
FROM customers c, limburg_area la
WHERE c.postal_code LIKE '65%' -- Edge case range
   OR c.postal_code LIKE '68%' -- Edge case range
ORDER BY c.postal_code;

-- 7. Performance test for validation function
EXPLAIN ANALYZE
SELECT 
    c.id,
    c.postal_code,
    is_postal_code_in_service_area(c.postal_code, sa.id) as in_area
FROM customers c
CROSS JOIN service_areas sa
WHERE sa.name = 'Limburg'
LIMIT 1000;

-- 8. Check cached validations
SELECT 
    COUNT(*) as total_cached,
    COUNT(*) FILTER (WHERE is_in_service_area = true) as valid_addresses,
    COUNT(*) FILTER (WHERE is_in_service_area = false) as invalid_addresses,
    MIN(validated_at) as oldest_validation,
    MAX(validated_at) as newest_validation
FROM validated_addresses;

-- 9. Summary statistics
WITH stats AS (
    SELECT 
        (SELECT COUNT(*) FROM service_areas WHERE is_active = true) as active_areas,
        (SELECT COUNT(*) FROM postal_code_ranges) as total_ranges,
        (SELECT COUNT(*) FROM validated_addresses) as cached_validations,
        (SELECT COUNT(*) FROM afspraken WHERE color_id IS NOT NULL) as colored_appointments
)
SELECT 
    json_build_object(
        'active_service_areas', active_areas,
        'postal_code_ranges', total_ranges,
        'cached_validations', cached_validations,
        'appointments_with_colors', colored_appointments,
        'setup_complete', active_areas > 0 AND total_ranges > 0
    ) as boundary_system_status
FROM stats;