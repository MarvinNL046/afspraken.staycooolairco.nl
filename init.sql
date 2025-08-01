-- StayCool Appointments Database Initialization
-- Create necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Create enum types
CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed', 'no_show');
CREATE TYPE service_type AS ENUM ('installation', 'maintenance', 'repair', 'consultation');
CREATE TYPE customer_type AS ENUM ('residential', 'business');

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE staycool_appointments TO developer;