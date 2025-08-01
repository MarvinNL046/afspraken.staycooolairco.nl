#!/usr/bin/env node
/**
 * Environment Variable Validation Script
 * Ensures all required environment variables are set before deployment
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Define required environment variables by category
const REQUIRED_ENV_VARS = {
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

// Optional but recommended variables
const RECOMMENDED_ENV_VARS = [
  'REDIS_URL',
  'SENTRY_DSN',
  'EMAIL_SERVICE_API_KEY',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
];

// Validation rules for specific variables
const VALIDATION_RULES = {
  NODE_ENV: (value) => ['production', 'staging', 'development', 'test'].includes(value),
  DATABASE_URL: (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
  REDIS_URL: (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
  JWT_SECRET: (value) => value.length >= 32,
  JWT_REFRESH_SECRET: (value) => value.length >= 32,
  ENCRYPTION_KEY: (value) => value.length === 32,
  INTERNAL_API_KEY: (value) => value.length >= 32,
  GOOGLE_SERVICE_ACCOUNT_KEY: (value) => {
    try {
      const decoded = Buffer.from(value, 'base64').toString();
      JSON.parse(decoded);
      return true;
    } catch {
      return false;
    }
  },
  CORS_ALLOWED_ORIGINS: (value) => {
    const origins = value.split(',');
    return origins.every(origin => origin.startsWith('http://') || origin.startsWith('https://'));
  },
  NEXT_PUBLIC_APP_URL: (value) => value.startsWith('https://'),
  NEXT_PUBLIC_API_URL: (value) => value.startsWith('https://'),
};

// Color codes for terminal output
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

function validateEnvironment() {
  log('\n🔍 Validating environment variables...', 'cyan');
  
  const errors = [];
  const warnings = [];
  let validatedCount = 0;
  
  // Check required variables
  Object.entries(REQUIRED_ENV_VARS).forEach(([category, vars]) => {
    log(`\n📁 Checking ${category} variables:`, 'blue');
    
    vars.forEach(varName => {
      const value = process.env[varName];
      
      if (!value) {
        errors.push(`❌ Missing required variable: ${varName}`);
        log(`  ❌ ${varName}: MISSING`, 'red');
      } else {
        // Apply validation rules if they exist
        if (VALIDATION_RULES[varName]) {
          if (VALIDATION_RULES[varName](value)) {
            log(`  ✅ ${varName}: Valid`, 'green');
            validatedCount++;
          } else {
            errors.push(`❌ Invalid value for ${varName}`);
            log(`  ❌ ${varName}: INVALID`, 'red');
          }
        } else {
          log(`  ✅ ${varName}: Set`, 'green');
          validatedCount++;
        }
      }
    });
  });
  
  // Check recommended variables
  log('\n📁 Checking recommended variables:', 'blue');
  RECOMMENDED_ENV_VARS.forEach(varName => {
    const value = process.env[varName];
    
    if (!value) {
      warnings.push(`⚠️  Recommended variable not set: ${varName}`);
      log(`  ⚠️  ${varName}: Not set (recommended)`, 'yellow');
    } else {
      log(`  ✅ ${varName}: Set`, 'green');
      validatedCount++;
    }
  });
  
  // Security checks
  log('\n🔒 Running security checks:', 'blue');
  
  // Check for weak secrets
  const secretVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'INTERNAL_API_KEY'];
  secretVars.forEach(varName => {
    const value = process.env[varName];
    if (value && value.length < 32) {
      warnings.push(`⚠️  ${varName} appears to be weak (< 32 characters)`);
    }
  });
  
  // Check for default values
  if (process.env.JWT_SECRET === 'your-secret-key-here') {
    errors.push('❌ JWT_SECRET contains default value');
  }
  
  // Verify production URL
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.NEXT_PUBLIC_APP_URL?.includes('staycoolairco.nl')) {
      warnings.push('⚠️  Production URL does not match expected domain');
    }
  }
  
  // Summary
  log('\n📊 Validation Summary:', 'cyan');
  log(`  Total variables checked: ${validatedCount + errors.length}`, 'blue');
  log(`  Valid: ${validatedCount}`, 'green');
  log(`  Errors: ${errors.length}`, errors.length > 0 ? 'red' : 'green');
  log(`  Warnings: ${warnings.length}`, warnings.length > 0 ? 'yellow' : 'green');
  
  // Output errors and warnings
  if (errors.length > 0) {
    log('\n❌ Errors found:', 'red');
    errors.forEach(error => log(`  ${error}`, 'red'));
  }
  
  if (warnings.length > 0) {
    log('\n⚠️  Warnings:', 'yellow');
    warnings.forEach(warning => log(`  ${warning}`, 'yellow'));
  }
  
  // Generate example secure values
  if (errors.length > 0) {
    log('\n💡 Example secure values:', 'cyan');
    log(`  JWT_SECRET: ${crypto.randomBytes(32).toString('base64')}`, 'blue');
    log(`  ENCRYPTION_KEY: ${crypto.randomBytes(16).toString('hex')}`, 'blue');
    log(`  INTERNAL_API_KEY: ${crypto.randomBytes(32).toString('hex')}`, 'blue');
  }
  
  // Exit with appropriate code
  if (errors.length > 0) {
    log('\n❌ Environment validation failed!', 'red');
    process.exit(1);
  } else {
    log('\n✅ Environment validation passed!', 'green');
    
    // Write validation report
    const report = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      validated: validatedCount,
      errors: errors.length,
      warnings: warnings.length,
      variables: Object.keys(process.env).filter(key => !key.startsWith('npm_')).length,
    };
    
    fs.writeFileSync(
      path.join(__dirname, '..', '.env-validation-report.json'),
      JSON.stringify(report, null, 2)
    );
    
    process.exit(0);
  }
}

// Run validation
validateEnvironment();