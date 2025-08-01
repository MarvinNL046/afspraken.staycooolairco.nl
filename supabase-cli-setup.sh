#!/bin/bash
# Supabase CLI Setup Script for StayCool Appointments

# Add local bin to PATH if not already there
export PATH="$HOME/.local/bin:$PATH"

# Supabase project details
export SUPABASE_PROJECT_ID="rlometuzddtaxoxavyto"
export SUPABASE_PROJECT_URL="https://rlometuzddtaxoxavyto.supabase.co"
export SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsb21ldHV6ZGR0YXhveGF2eXRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQwNTE4MzIsImV4cCI6MjA2OTYyNzgzMn0.buXX11L0-kWnbdn9cGhXVwGtmg1c2WDMd7M6vStox3M"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsb21ldHV6ZGR0YXhveGF2eXRvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDA1MTgzMiwiZXhwIjoyMDY5NjI3ODMyfQ.4X5bUkOep2rsE8iG56i49RKBp9B4H17LWkxj0h64Mx4"

echo "🚀 Supabase CLI is installed and ready to use!"
echo ""
echo "Available commands:"
echo "  supabase --help                    # Show all commands"
echo "  supabase db remote status          # Check database status"
echo "  supabase db remote commit          # Create migration from remote changes"
echo "  supabase functions list            # List edge functions"
echo ""
echo "To connect to your project, you need to:"
echo "1. Go to https://app.supabase.com/account/tokens"
echo "2. Generate a new access token"
echo "3. Run: supabase login --token YOUR_TOKEN"
echo ""
echo "Or set the environment variable:"
echo "export SUPABASE_ACCESS_TOKEN=YOUR_TOKEN"
echo ""
echo "Project details:"
echo "  Project ID: $SUPABASE_PROJECT_ID"
echo "  Project URL: $SUPABASE_PROJECT_URL"