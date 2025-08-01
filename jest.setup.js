// Jest setup file for all tests
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
import { jest } from '@jest/globals';

// Polyfills for Node.js environment
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      pathname: '/',
      query: {},
      asPath: '/',
      events: {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
      },
    };
  },
  useSearchParams() {
    return new URLSearchParams();
  },
  usePathname() {
    return '/';
  },
}));

// Mock environment variables
process.env = {
  ...process.env,
  NODE_ENV: 'test',
  NEXT_PUBLIC_API_URL: 'http://localhost:3000',
  JWT_SECRET: 'test-jwt-secret',
  ENCRYPTION_KEY: 'test-encryption-key-32-chars-long',
};

// Global test utilities
global.createMockRequest = (options = {}) => ({
  method: 'GET',
  headers: new Headers({
    'content-type': 'application/json',
    ...options.headers,
  }),
  body: options.body || null,
  query: options.query || {},
  cookies: options.cookies || {},
  ...options,
});

global.createMockResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    getHeader: jest.fn(),
    redirect: jest.fn().mockReturnThis(),
    end: jest.fn(),
  };
  return res;
};

// Silence console during tests unless explicitly needed
const originalConsole = { ...console };
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Restore console for debugging when needed
global.restoreConsole = () => {
  global.console = originalConsole;
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Increase timeout for async operations
jest.setTimeout(10000);