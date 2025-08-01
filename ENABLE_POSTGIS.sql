-- Enable PostGIS extension in Supabase
-- Run this in the Supabase SQL Editor (https://app.supabase.com/project/rlometuzddtaxoxavyto/editor)

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Verify the extension is enabled
SELECT extname, extversion 
FROM pg_extension 
WHERE extname = 'postgis';

-- If you get an error, you might need to run this first:
-- CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;