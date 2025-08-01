#!/usr/bin/env node
/**
 * Check Netlify Environment Variables Status
 * This script checks which required environment variables are configured in Netlify
 */

const { execSync } = require('child_process');

// Define required environment variables
const REQUIRED_VARS = {
  // Core Application
  application: [
    'NODE_ENV',
    'NEXT_PUBLIC_ENV',
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_API_URL',
  ],
  
  // Database
  database: [
    'DATABASE_URL',
  ],
  
  // Authentication
  authentication: [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_KEY',
    'INTERNAL_API_KEY',
  ],
  
  // Google APIs
  google: [
    'GOOGLE_MAPS_API_KEY',
    'GOOGLE_CALENDAR_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_KEY',
  ],
  
  // GoHighLevel
  gohighlevel: [
    'GOHIGHLEVEL_API_KEY',
    'GOHIGHLEVEL_LOCATION_ID',
    'GOHIGHLEVEL_WEBHOOK_SECRET',
  ],
  
  // Security
  security: [
    'CORS_ALLOWED_ORIGINS',
    'FRONTEND_URL',
  ],
};

// Optional variables
const OPTIONAL_VARS = [
  'REDIS_URL',
  'SENTRY_DSN',
  'EMAIL_SERVICE_API_KEY',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
];

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function getNetlifyEnvVars() {
  try {
    // Get list of environment variables from Netlify
    // Note: netlify env:list doesn't support --json flag, so we'll parse the text output
    const output = execSync('netlify env:list', { encoding: 'utf8' });
    
    // Parse the table output to extract variable names
    const lines = output.split('\n');
    const envVars = [];
    
    // Skip header lines and parse the table
    let inTable = false;
    for (const line of lines) {
      if (line.includes('|') && line.includes('*')) {
        inTable = true;
        const parts = line.split('|').map(p => p.trim());
        if (parts[0] && parts[0] !== '' && !parts[0].includes('---')) {
          envVars.push(parts[0]);
        }
      }
    }
    
    // Remove any header items
    return envVars.filter(v => v && !v.includes('Key') && !v.includes('---'));
  } catch (error) {
    log('Error: Could not fetch Netlify environment variables', 'red');
    log('Make sure you are logged in to Netlify CLI and have a site linked', 'yellow');
    log('Error details: ' + error.message, 'red');
    process.exit(1);
  }
}

function checkEnvironmentVariables() {
  log('\n🔍 Checking Netlify Environment Variables...', 'cyan');
  
  const netlifyVars = getNetlifyEnvVars();
  const configuredCount = { required: 0, optional: 0 };
  const missingRequired = [];
  const missingOptional = [];
  
  // Check required variables
  log('\n📋 Required Variables:', 'blue');
  Object.entries(REQUIRED_VARS).forEach(([category, vars]) => {
    log(`\n  ${category.charAt(0).toUpperCase() + category.slice(1)}:`, 'cyan');
    
    vars.forEach(varName => {
      if (netlifyVars.includes(varName)) {
        log(`    ✅ ${varName}`, 'green');
        configuredCount.required++;
      } else {
        log(`    ❌ ${varName} - MISSING`, 'red');
        missingRequired.push({ category, varName });
      }
    });
  });
  
  // Check optional variables
  log('\n📋 Optional Variables:', 'blue');
  OPTIONAL_VARS.forEach(varName => {
    if (netlifyVars.includes(varName)) {
      log(`    ✅ ${varName}`, 'green');
      configuredCount.optional++;
    } else {
      log(`    ⚠️  ${varName} - Not configured (optional)`, 'yellow');
      missingOptional.push(varName);
    }
  });
  
  // Summary
  const totalRequired = Object.values(REQUIRED_VARS).flat().length;
  log('\n📊 Summary:', 'cyan');
  log(`  Required: ${configuredCount.required}/${totalRequired} configured`, 
    configuredCount.required === totalRequired ? 'green' : 'yellow');
  log(`  Optional: ${configuredCount.optional}/${OPTIONAL_VARS.length} configured`, 'blue');
  
  // Missing critical variables
  if (missingRequired.length > 0) {
    log('\n❌ Critical Missing Variables:', 'red');
    
    // Check for DATABASE_URL specifically
    const dbMissing = missingRequired.find(v => v.varName === 'DATABASE_URL');
    if (dbMissing) {
      log('\n  🚨 DATABASE_URL is missing!', 'red');
      log('  This is required for the application to function.', 'red');
      log('  Follow the setup guide in docs/NETLIFY_ENV_SETUP.md', 'yellow');
    }
    
    // Check for GoHighLevel variables
    const ghlMissing = missingRequired.filter(v => v.category === 'gohighlevel');
    if (ghlMissing.length > 0) {
      log('\n  ⚠️  GoHighLevel variables are missing', 'yellow');
      log('  These are optional for MVP but required for CRM integration', 'yellow');
    }
  }
  
  // Next steps
  if (missingRequired.some(v => v.varName === 'DATABASE_URL')) {
    log('\n🔧 Next Steps:', 'cyan');
    log('  1. Set up a PostgreSQL database (Supabase recommended)', 'blue');
    log('  2. Add DATABASE_URL to Netlify:', 'blue');
    log('     netlify env:set DATABASE_URL "postgresql://..."', 'yellow');
    log('  3. Run database migrations:', 'blue');
    log('     npx prisma migrate deploy', 'yellow');
    log('  4. Deploy to Netlify:', 'blue');
    log('     netlify deploy --prod', 'yellow');
  } else if (configuredCount.required === totalRequired) {
    log('\n✅ All required environment variables are configured!', 'green');
    log('  You can now deploy your application:', 'blue');
    log('     netlify deploy --prod', 'yellow');
  }
  
  // Exit with appropriate code
  process.exit(missingRequired.length > 0 ? 1 : 0);
}

// Run the check
checkEnvironmentVariables();