-- Migration: Add service area boundaries for appointment scheduling

-- Create service_areas table
CREATE TABLE IF NOT EXISTS service_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    province VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    calendar_color_id VARCHAR(10), -- Google Calendar color ID
    sales_person_id VARCHAR(255),
    sales_person_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for active service areas
CREATE INDEX idx_service_areas_is_active ON service_areas(is_active);

-- Create postal_code_ranges table
CREATE TABLE IF NOT EXISTS postal_code_ranges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_area_id UUID NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
    start_code VARCHAR(10) NOT NULL,
    end_code VARCHAR(10) NOT NULL,
    excluded_codes TEXT[] DEFAULT ARRAY[]::TEXT[]
);

-- Create index for postal code lookups
CREATE INDEX idx_postal_code_ranges_codes ON postal_code_ranges(start_code, end_code);

-- Create boundary_polygons table for precise geographic boundaries
CREATE TABLE IF NOT EXISTS boundary_polygons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_area_id UUID UNIQUE NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
    polygon JSONB NOT NULL, -- GeoJSON format
    simplified_polygon JSONB, -- Simplified version for faster checks
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create validated_addresses cache table
CREATE TABLE IF NOT EXISTS validated_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    postal_code VARCHAR(10) NOT NULL,
    city VARCHAR(255) NOT NULL,
    province VARCHAR(255),
    service_area_id UUID REFERENCES service_areas(id) ON DELETE SET NULL,
    is_in_service_area BOOLEAN DEFAULT false,
    validated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE(postal_code, city)
);

-- Create indexes for validated addresses
CREATE INDEX idx_validated_addresses_postal_code ON validated_addresses(postal_code);
CREATE INDEX idx_validated_addresses_service_area ON validated_addresses(service_area_id);

-- Insert Limburg service area with postal code ranges
INSERT INTO service_areas (name, province, is_active, calendar_color_id, sales_person_name)
VALUES ('Limburg', 'Limburg', true, '5', 'Limburg Sales Team');

-- Insert Limburg postal code ranges
-- Primary range covering most of Limburg
INSERT INTO postal_code_ranges (service_area_id, start_code, end_code)
SELECT id, '5800', '6999'
FROM service_areas
WHERE name = 'Limburg';

-- Add specific postal code ranges for Limburg municipalities
-- These are more precise ranges based on actual Limburg municipalities
INSERT INTO postal_code_ranges (service_area_id, start_code, end_code)
SELECT id, start_code, end_code
FROM service_areas, (VALUES
    ('5900', '5999'), -- Venlo region
    ('6000', '6099'), -- Weert region  
    ('6100', '6199'), -- Echt, Sittard region
    ('6200', '6299'), -- Maastricht region
    ('6300', '6399'), -- Valkenburg region
    ('6400', '6499'), -- Heerlen region
    ('6500', '6599'), -- Nijmegen region (some overlap, needs validation)
    ('6600', '6699'), -- Northern Limburg
    ('6700', '6799'), -- Southern Limburg
    ('6800', '6899'), -- Arnhem region (some overlap, needs validation)
    ('6900', '6999')  -- Eastern Limburg
) AS ranges(start_code, end_code)
WHERE service_areas.name = 'Limburg';

-- Create function to check if postal code is in range
CREATE OR REPLACE FUNCTION is_postal_code_in_service_area(
    p_postal_code VARCHAR,
    p_service_area_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_numeric_code INTEGER;
    v_in_range BOOLEAN := FALSE;
BEGIN
    -- Extract numeric part of postal code (first 4 digits)
    v_numeric_code := CAST(SUBSTRING(p_postal_code FROM 1 FOR 4) AS INTEGER);
    
    -- Check if postal code is in any range for the service area
    SELECT EXISTS (
        SELECT 1
        FROM postal_code_ranges
        WHERE service_area_id = p_service_area_id
        AND v_numeric_code >= CAST(start_code AS INTEGER)
        AND v_numeric_code <= CAST(end_code AS INTEGER)
        AND p_postal_code != ALL(excluded_codes)
    ) INTO v_in_range;
    
    RETURN v_in_range;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_service_areas_updated_at
    BEFORE UPDATE ON service_areas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_boundary_polygons_updated_at
    BEFORE UPDATE ON boundary_polygons
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE service_areas IS 'Defines geographic service areas for appointment scheduling';
COMMENT ON TABLE postal_code_ranges IS 'Postal code ranges for each service area';
COMMENT ON TABLE boundary_polygons IS 'Precise geographic boundaries in GeoJSON format';
COMMENT ON TABLE validated_addresses IS 'Cache for validated address lookups';
COMMENT ON COLUMN service_areas.calendar_color_id IS 'Google Calendar color ID (5=yellow)';
COMMENT ON FUNCTION is_postal_code_in_service_area IS 'Check if a postal code belongs to a service area';