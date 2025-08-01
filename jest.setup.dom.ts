/**
 * Jest Setup for DOM/Component Tests
 * 
 * Sets up the test environment for React component testing
 */

import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'util';

// Polyfills for jsdom
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

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
    };
  },
  useSearchParams() {
    return new URLSearchParams();
  },
  usePathname() {
    return '/';
  },
}));

// Mock Next.js Image component
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => {
    return props;
  },
}));

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock Google Maps
global.google = {
  maps: {
    Map: jest.fn(() => ({
      setCenter: jest.fn(),
      setZoom: jest.fn(),
    })),
    Marker: jest.fn(() => ({
      setMap: jest.fn(),
      setPosition: jest.fn(),
    })),
    LatLng: jest.fn((lat, lng) => ({ lat, lng })),
    LatLngBounds: jest.fn(() => ({
      extend: jest.fn(),
    })),
    places: {
      Autocomplete: jest.fn(() => ({
        addListener: jest.fn(),
        getPlace: jest.fn(() => ({
          geometry: {
            location: {
              lat: () => 52.3676,
              lng: () => 4.9041,
            },
          },
          formatted_address: 'Test Address',
        })),
      })),
    },
  },
} as any;

// Cleanup after each test
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

// Mock fetch for API calls
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
    headers: new Headers(),
  } as Response)
);

// Custom render function with providers
const React = require('react');
import { render as rtlRender } from '@testing-library/react';
import type { RenderOptions } from '@testing-library/react';

// Add any providers here
function AllTheProviders({ children }: { children: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

export function render(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return rtlRender(ui, { wrapper: AllTheProviders, ...options });
}

// Re-export everything
export * from '@testing-library/react';