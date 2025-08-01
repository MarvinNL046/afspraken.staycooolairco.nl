/**
 * Playwright Global Teardown
 * 
 * Runs once after all tests to clean up the test environment
 */

import { FullConfig } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function globalTeardown(config: FullConfig) {
  console.log('🧹 Starting Playwright global teardown...');
  
  try {
    // Clean up test data
    console.log('🗑️  Cleaning up test data...');
    
    await prisma.$transaction([
      // Delete test appointments
      prisma.afspraak.deleteMany({
        where: {
          lead: {
            bronId: {
              startsWith: 'e2e-',
            },
          },
        },
      }),
      
      // Delete test leads
      prisma.lead.deleteMany({
        where: {
          bronId: {
            startsWith: 'e2e-',
          },
        },
      }),
      
      // Delete test customers
      prisma.customer.deleteMany({
        where: {
          email: {
            contains: '@example.com',
          },
        },
      }),
    ]);
    
    console.log('✅ Test data cleaned up successfully');
    
  } catch (error) {
    console.error('⚠️  Error during global teardown:', error);
    // Don't throw to avoid failing the test run
  } finally {
    await prisma.$disconnect();
  }
  
  // Remove test env vars
  delete process.env.TEST_LEAD_ID_1;
  delete process.env.TEST_LEAD_ID_2;
  
  console.log('✅ Playwright global teardown completed');
}

export default globalTeardown;