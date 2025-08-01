/**
 * Playwright Global Setup
 * 
 * Runs once before all tests to set up the test environment
 */

import { FullConfig } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting Playwright global setup...');
  
  // Store original env vars
  const originalEnv = { ...process.env };
  
  // Set test environment variables
  (process.env as any).NODE_ENV = 'test';
  (process.env as any).DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  (process.env as any).JWT_SECRET_KEY = 'test-secret-key-for-e2e-testing-that-is-long-enough';
  (process.env as any).GOHIGHLEVEL_WEBHOOK_SECRET = 'test-webhook-secret';
  (process.env as any).BASE_URL = config.projects[0].use.baseURL;
  
  try {
    // Clean up test database
    console.log('🧹 Cleaning test database...');
    await prisma.$transaction([
      prisma.afspraak.deleteMany(),
      prisma.lead.deleteMany(),
      prisma.customer.deleteMany(),
      prisma.timeSlot.deleteMany(),
      prisma.blockedDate.deleteMany(),
    ]);
    
    // Seed test data
    console.log('🌱 Seeding test data...');
    
    // Create test leads
    const testLead1 = await prisma.lead.create({
      data: {
        bronSysteem: 'test',
        bronId: 'e2e-lead-1',
        naam: 'Test User 1',
        email: 'test1@example.com',
        telefoon: '0612345678',
        adres: 'Teststraat 1',
        stad: 'Amsterdam',
        postcode: '1234AB',
        status: 'nieuw',
      },
    });
    
    const testLead2 = await prisma.lead.create({
      data: {
        bronSysteem: 'test',
        bronId: 'e2e-lead-2',
        naam: 'Test User 2',
        email: 'test2@example.com',
        telefoon: '0687654321',
        adres: 'Testlaan 2',
        stad: 'Rotterdam',
        postcode: '3012CD',
        status: 'nieuw',
      },
    });
    
    // Create test appointments
    await prisma.afspraak.create({
      data: {
        leadId: testLead2.id,
        datum: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        tijd: '10:00',
        duur: 120,
        locatie: 'Testlaan 2, 3012CD Rotterdam',
        serviceType: 'onderhoud',
        status: 'gepland',
        beschrijving: 'E2E test appointment',
      },
    });
    
    console.log('✅ Test data seeded successfully');
    
    // Store test data IDs for use in tests
    process.env.TEST_LEAD_ID_1 = testLead1.id;
    process.env.TEST_LEAD_ID_2 = testLead2.id;
    
  } catch (error) {
    console.error('❌ Global setup failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
  
  console.log('✅ Playwright global setup completed');
  
  // Return a teardown function
  return async () => {
    // Restore original env vars
    Object.assign(process.env, originalEnv);
  };
}

export default globalSetup;