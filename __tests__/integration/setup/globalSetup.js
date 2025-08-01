const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

module.exports = async () => {
  console.log('🚀 Setting up integration test environment...');

  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/staycool_test';
  process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';

  try {
    // Initialize Prisma client
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    // Run database migrations
    console.log('📦 Running database migrations...');
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    });

    // Seed test data
    console.log('🌱 Seeding test database...');
    
    // Create service areas
    await prisma.serviceArea.createMany({
      data: [
        {
          name: 'Amsterdam Region',
          postalCode: '1000AA',
          city: 'Amsterdam',
          province: 'Noord-Holland',
          isActive: true,
        },
        {
          name: 'Utrecht Region',
          postalCode: '3500AA',
          city: 'Utrecht',
          province: 'Utrecht',
          isActive: true,
        },
        {
          name: 'Rotterdam Region',
          postalCode: '3000AA',
          city: 'Rotterdam',
          province: 'Zuid-Holland',
          isActive: true,
        },
      ],
      skipDuplicates: true,
    });

    // Create test technicians
    await prisma.technician.createMany({
      data: [
        {
          name: 'Test Technician 1',
          email: 'tech1@staycoolairco.nl',
          phone: '0612345678',
          specializations: ['AC_INSTALLATION', 'AC_MAINTENANCE'],
          isActive: true,
        },
        {
          name: 'Test Technician 2',
          email: 'tech2@staycoolairco.nl',
          phone: '0687654321',
          specializations: ['AC_REPAIR', 'EMERGENCY_REPAIR'],
          isActive: true,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.$disconnect();

    // Initialize Redis
    const redis = new Redis(process.env.REDIS_URL);
    
    // Clear Redis test database
    console.log('🗑️  Clearing Redis cache...');
    await redis.flushdb();
    await redis.quit();

    console.log('✅ Integration test environment ready!\n');
  } catch (error) {
    console.error('❌ Failed to set up test environment:', error);
    process.exit(1);
  }
};