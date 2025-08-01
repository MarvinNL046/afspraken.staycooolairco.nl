/**
 * Jest Setup for Integration Tests
 * 
 * Sets up the test environment for integration testing
 */

import { PrismaClient } from '@prisma/client';
import { mockDeep, mockReset } from 'jest-mock-extended';
import type { DeepMockProxy } from 'jest-mock-extended';

// Extend Jest matchers
import '@testing-library/jest-dom';

// Set test environment variables
(process.env as any).NODE_ENV = 'test';
(process.env as any).JWT_SECRET_KEY = 'test-secret-key-that-is-at-least-32-characters-long';
(process.env as any).DATABASE_URL = 'postgresql://test:test@localhost:5432/test_integration';
(process.env as any).REDIS_URL = 'redis://localhost:6379/1';
(process.env as any).GOOGLE_MAPS_API_KEY = 'test-google-maps-key';
(process.env as any).GOHIGHLEVEL_API_KEY = 'test-ghl-key';

// Mock Prisma client
export const prismaMock: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>();

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  prisma: prismaMock,
}));

// Reset mocks before each test
beforeEach(() => {
  mockReset(prismaMock);
  jest.clearAllMocks();
});

// Cleanup after all tests
afterAll(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));
});

// Global test utilities
global.createTestUser = async (overrides = {}) => {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    naam: 'Test User',
    telefoon: '0612345678',
    ...overrides,
  };
};

global.createTestAppointment = async (overrides = {}) => {
  return {
    id: 'test-appointment-id',
    datum: new Date('2024-12-25'),
    tijd: '10:00',
    duur: 120,
    locatie: 'Test Street 123, Amsterdam',
    serviceType: 'onderhoud',
    status: 'gepland',
    ...overrides,
  };
};

// Mock external services
jest.mock('@/lib/services/google-maps-cached', () => ({
  GoogleMapsService: jest.fn().mockImplementation(() => ({
    geocodeAddress: jest.fn().mockResolvedValue({
      latitude: 52.3676,
      longitude: 4.9041,
      formatted_address: 'Test Street 123, 1234 AB Amsterdam',
    }),
    calculateRoute: jest.fn().mockResolvedValue({
      distance: 1000,
      duration: 600,
      polyline: 'encoded_polyline_string',
    }),
    getDistanceMatrix: jest.fn().mockResolvedValue({
      rows: [{
        elements: [{
          distance: { value: 1000 },
          duration: { value: 600 },
          status: 'OK',
        }],
      }],
    }),
  })),
}));

// Mock Redis
jest.mock('ioredis', () => {
  const Redis = jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    keys: jest.fn(),
    mget: jest.fn(),
    mset: jest.fn(),
    pipeline: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    }),
    quit: jest.fn(),
  }));
  return { default: Redis };
});

// Suppress console output during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Add custom matchers
expect.extend({
  toBeValidDate(received: any) {
    const pass = received instanceof Date && !isNaN(received.getTime());
    return {
      pass,
      message: () => 
        pass
          ? `expected ${received} not to be a valid date`
          : `expected ${received} to be a valid date`,
    };
  },
  
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be within range ${floor} - ${ceiling}`
          : `expected ${received} to be within range ${floor} - ${ceiling}`,
    };
  },
});

// TypeScript declarations for global test utilities
declare global {
  var createTestUser: (overrides?: any) => Promise<any>;
  var createTestAppointment: (overrides?: any) => Promise<any>;
  
  namespace jest {
    interface Matchers<R> {
      toBeValidDate(): R;
      toBeWithinRange(floor: number, ceiling: number): R;
    }
  }
}