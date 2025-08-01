#!/usr/bin/env node
/**
 * Check Supabase Database Connection and Status
 */

const { createClient } = require('@supabase/supabase-js');
const { PrismaClient } = require('@prisma/client');

// Load environment variables
require('dotenv').config();

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

async function checkSupabaseConnection() {
  log('\n🔍 Checking Supabase Connection...', 'cyan');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    log('  ❌ Supabase credentials not found', 'red');
    return false;
  }
  
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Try to fetch from a system table
    const { data, error } = await supabase
      .from('_prisma_migrations')
      .select('id')
      .limit(1);
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = table not found (which is ok)
      log(`  ❌ Supabase connection failed: ${error.message}`, 'red');
      return false;
    }
    
    log('  ✅ Supabase connection successful', 'green');
    log(`  📍 URL: ${supabaseUrl}`, 'blue');
    return true;
  } catch (error) {
    log(`  ❌ Supabase connection error: ${error.message}`, 'red');
    return false;
  }
}

async function checkPrismaConnection() {
  log('\n🔍 Checking Prisma Database Connection...', 'cyan');
  
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    log('  ❌ DATABASE_URL not found', 'red');
    return false;
  }
  
  const prisma = new PrismaClient();
  
  try {
    // Test connection
    await prisma.$connect();
    
    // Check migrations
    const migrations = await prisma.$queryRaw`
      SELECT id, migration_name, finished_at 
      FROM _prisma_migrations 
      ORDER BY started_at DESC 
      LIMIT 5
    `;
    
    log('  ✅ Prisma connection successful', 'green');
    log(`  📊 Recent migrations:`, 'blue');
    migrations.forEach(m => {
      log(`     - ${m.migration_name} (${m.finished_at ? 'completed' : 'pending'})`, 'blue');
    });
    
    // Count records in main tables
    const leadCount = await prisma.lead.count();
    const appointmentCount = await prisma.afspraak.count();
    
    log(`  📈 Database stats:`, 'blue');
    log(`     - Leads: ${leadCount}`, 'blue');
    log(`     - Appointments: ${appointmentCount}`, 'blue');
    
    await prisma.$disconnect();
    return true;
  } catch (error) {
    log(`  ❌ Prisma connection error: ${error.message}`, 'red');
    await prisma.$disconnect();
    return false;
  }
}

async function checkDatabaseExtensions() {
  log('\n🔍 Checking Required Database Extensions...', 'cyan');
  
  const prisma = new PrismaClient();
  
  try {
    const extensions = await prisma.$queryRaw`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname IN ('uuid-ossp', 'postgis')
    `;
    
    const requiredExtensions = ['uuid-ossp', 'postgis'];
    const installedExtensions = extensions.map(e => e.extname);
    
    requiredExtensions.forEach(ext => {
      if (installedExtensions.includes(ext)) {
        const version = extensions.find(e => e.extname === ext)?.extversion;
        log(`  ✅ ${ext} (v${version})`, 'green');
      } else {
        log(`  ❌ ${ext} - NOT INSTALLED`, 'red');
      }
    });
    
    await prisma.$disconnect();
    return installedExtensions.length === requiredExtensions.length;
  } catch (error) {
    log(`  ❌ Could not check extensions: ${error.message}`, 'red');
    await prisma.$disconnect();
    return false;
  }
}

async function main() {
  log('🚀 StayCool Database Status Check', 'cyan');
  
  const checks = {
    supabase: await checkSupabaseConnection(),
    prisma: await checkPrismaConnection(),
    extensions: await checkDatabaseExtensions(),
  };
  
  log('\n📊 Summary:', 'cyan');
  log(`  Supabase SDK: ${checks.supabase ? '✅' : '❌'}`, checks.supabase ? 'green' : 'red');
  log(`  Prisma ORM: ${checks.prisma ? '✅' : '❌'}`, checks.prisma ? 'green' : 'red');
  log(`  Extensions: ${checks.extensions ? '✅' : '❌'}`, checks.extensions ? 'green' : 'red');
  
  const allChecksPass = Object.values(checks).every(check => check);
  
  if (allChecksPass) {
    log('\n✅ All database checks passed!', 'green');
    log('Your application is ready to use the database.', 'green');
  } else {
    log('\n❌ Some database checks failed', 'red');
    log('Please check the error messages above.', 'yellow');
  }
  
  process.exit(allChecksPass ? 0 : 1);
}

main().catch(console.error);