/** @type {import('jest').Config} */
const baseConfig = require('./jest.config');

const config = {
  ...baseConfig,
  
  // Integration test specific settings
  displayName: 'Integration Tests',
  testMatch: [
    '**/__tests__/integration/**/*.(test|spec).(ts|tsx|js)',
    '**/integration.test.(ts|tsx|js)'
  ],
  
  // Longer timeout for integration tests
  testTimeout: 30000,
  
  // Setup for integration tests
  setupFilesAfterEnv: [
    '<rootDir>/jest.setup.js',
    '<rootDir>/jest.setup.integration.js'
  ],
  
  // Environment variables for integration tests
  testEnvironmentOptions: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/staycool_test',
      REDIS_URL: process.env.TEST_REDIS_URL || 'redis://localhost:6379/1',
      JWT_SECRET: 'test-jwt-secret',
      NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'test-google-maps-key'
    }
  },
  
  // Global setup and teardown
  globalSetup: '<rootDir>/__tests__/integration/setup/globalSetup.js',
  globalTeardown: '<rootDir>/__tests__/integration/setup/globalTeardown.js',
  
  // Separate coverage for integration tests
  coverageDirectory: '<rootDir>/coverage/integration'
};

module.exports = config;