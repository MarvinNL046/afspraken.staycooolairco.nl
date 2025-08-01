const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

module.exports = async () => {
  console.log('\n🧹 Cleaning up integration test environment...');

  try {
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/staycool_test',
        },
      },
    });

    // Clean up database
    await prisma.appointmentStatusHistory.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.user.deleteMany();
    await prisma.serviceArea.deleteMany();
    await prisma.technician.deleteMany();
    
    await prisma.$disconnect();

    // Clean up Redis
    const redis = new Redis(process.env.TEST_REDIS_URL || 'redis://localhost:6379/1');
    await redis.flushdb();
    await redis.quit();

    console.log('✅ Test environment cleaned up successfully!\n');
  } catch (error) {
    console.error('❌ Failed to clean up test environment:', error);
  }
};