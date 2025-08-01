// Additional setup for integration tests
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { jest } from '@jest/globals';

// Initialize test database client
global.prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/staycool_test',
    },
  },
});

// Initialize test Redis client
global.redis = new Redis(process.env.TEST_REDIS_URL || 'redis://localhost:6379/1');

// Mock external services for integration tests
jest.mock('@/lib/services/googleMapsService', () => ({
  validateAddress: jest.fn().mockResolvedValue({
    formatted_address: 'Test Street 123, 1234 AB Amsterdam, Netherlands',
    lat: 52.3676,
    lng: 4.9041,
    place_id: 'test-place-id',
  }),
  calculateRoute: jest.fn().mockResolvedValue({
    distance: 10000,
    duration: 1200,
    polyline: 'test-polyline',
  }),
  getDistanceMatrix: jest.fn().mockResolvedValue({
    rows: [{
      elements: [{
        distance: { value: 10000 },
        duration: { value: 1200 },
        status: 'OK',
      }],
    }],
  }),
}));

jest.mock('@/lib/services/googleCalendarService', () => ({
  createEvent: jest.fn().mockResolvedValue({
    id: 'test-event-id',
    htmlLink: 'https://calendar.google.com/event?id=test-event-id',
  }),
  updateEvent: jest.fn().mockResolvedValue({
    id: 'test-event-id',
    status: 'confirmed',
  }),
  deleteEvent: jest.fn().mockResolvedValue(true),
  getAvailableSlots: jest.fn().mockResolvedValue([
    { start: '2024-01-01T09:00:00Z', end: '2024-01-01T10:00:00Z' },
    { start: '2024-01-01T10:00:00Z', end: '2024-01-01T11:00:00Z' },
  ]),
}));

jest.mock('@/lib/services/goHighLevelService', () => ({
  createContact: jest.fn().mockResolvedValue({
    id: 'test-contact-id',
    email: 'test@example.com',
  }),
  updateContact: jest.fn().mockResolvedValue({
    id: 'test-contact-id',
    email: 'test@example.com',
  }),
  createOpportunity: jest.fn().mockResolvedValue({
    id: 'test-opportunity-id',
    name: 'Test Opportunity',
  }),
}));

// Helper functions for integration tests
global.createTestUser = async (overrides = {}) => {
  return await global.prisma.user.create({
    data: {
      email: 'test@example.com',
      password: 'hashed-password',
      role: 'USER',
      ...overrides,
    },
  });
};

global.createTestAppointment = async (userId, overrides = {}) => {
  return await global.prisma.appointment.create({
    data: {
      userId,
      serviceType: 'AC_INSTALLATION',
      scheduledDate: new Date('2024-01-01T10:00:00Z'),
      scheduledEndDate: new Date('2024-01-01T11:00:00Z'),
      address: 'Test Street 123',
      city: 'Amsterdam',
      postalCode: '1234AB',
      status: 'SCHEDULED',
      ...overrides,
    },
  });
};

// Clean up database before each test
beforeEach(async () => {
  // Clear Redis cache
  await global.redis.flushdb();
  
  // Clear database tables in correct order (respecting foreign keys)
  await global.prisma.appointmentStatusHistory.deleteMany();
  await global.prisma.appointment.deleteMany();
  await global.prisma.user.deleteMany();
  await global.prisma.serviceArea.deleteMany();
  await global.prisma.technician.deleteMany();
});

// Close connections after all tests
afterAll(async () => {
  await global.prisma.$disconnect();
  await global.redis.quit();
});