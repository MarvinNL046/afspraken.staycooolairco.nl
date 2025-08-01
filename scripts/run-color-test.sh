#!/bin/bash

# Load environment variables
source .env.local

# Run the test color filtering endpoint
echo "🔍 Testing Google Calendar Color Filtering..."
echo "============================================"
echo ""

# First, let's check the actual color definitions from Google
echo "1. Verifying Google Calendar Colors:"
curl -s -X GET "http://localhost:8888/.netlify/functions/verify-calendar-colors" \
  -H "x-api-key: ${ADMIN_API_KEY:-your-admin-api-key}" | jq '.'

echo ""
echo "2. Testing Color Filtering for Today:"
curl -s -X GET "http://localhost:8888/.netlify/functions/test-color-filtering" \
  -H "x-api-key: ${ADMIN_API_KEY:-your-admin-api-key}" | jq '.'

echo ""
echo "Done! ✅"