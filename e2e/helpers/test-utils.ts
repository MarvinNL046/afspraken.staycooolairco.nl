/**
 * E2E Test Utilities
 * 
 * Common utilities and helpers for Playwright E2E tests
 */

import { Page, expect } from '@playwright/test';
import { JWTService } from '@/lib/services/auth/jwt.service';

// Test data generators
export const generateTestData = {
  lead: (overrides: Partial<any> = {}) => ({
    naam: 'Test User',
    email: `test-${Date.now()}@example.com`,
    telefoon: '0612345678',
    adres: 'Teststraat 123',
    stad: 'Amsterdam',
    postcode: '1234AB',
    ...overrides,
  }),
  
  booking: (overrides: Partial<any> = {}) => ({
    datum: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 14 days from now
    tijd: '14:00',
    serviceType: 'onderhoud',
    vraag: 'Test vraag voor E2E test',
    ...overrides,
  }),
  
  contact: (overrides: Partial<any> = {}) => ({
    naam: 'Contact Test',
    email: `contact-${Date.now()}@example.com`,
    telefoon: '0687654321',
    bericht: 'Dit is een test bericht voor de E2E test suite.',
    ...overrides,
  }),
};

// Page object helpers
export class PageHelpers {
  constructor(private page: Page) {}
  
  async fillForm(data: Record<string, string>) {
    for (const [field, value] of Object.entries(data)) {
      const input = this.page.locator(`[name="${field}"], [id="${field}"], [data-testid="${field}"]`).first();
      await input.fill(value);
    }
  }
  
  async selectOption(field: string, value: string) {
    const select = this.page.locator(`select[name="${field}"], select[id="${field}"], select[data-testid="${field}"]`).first();
    await select.selectOption(value);
  }
  
  async clickButton(text: string) {
    await this.page.locator(`button:has-text("${text}")`).click();
  }
  
  async waitForToast(message: string) {
    const toast = this.page.locator('[role="alert"], .toast, .notification').filter({ hasText: message });
    await expect(toast).toBeVisible();
    return toast;
  }
  
  async waitForLoadingToComplete() {
    // Wait for any loading indicators to disappear
    await this.page.waitForSelector('.loading, [data-loading="true"], .spinner', { state: 'hidden' });
    // Wait for network to be idle
    await this.page.waitForLoadState('networkidle');
  }
  
  async checkAccessibility() {
    // Basic accessibility checks
    const violations = [];
    
    // Check for images without alt text
    const imagesWithoutAlt = await this.page.locator('img:not([alt])').count();
    if (imagesWithoutAlt > 0) {
      violations.push(`${imagesWithoutAlt} images without alt text`);
    }
    
    // Check for form inputs without labels
    const inputsWithoutLabels = await this.page.locator('input:not([aria-label]):not([aria-labelledby])').count();
    if (inputsWithoutLabels > 0) {
      violations.push(`${inputsWithoutLabels} form inputs without labels`);
    }
    
    // Check for buttons without accessible text
    const buttonsWithoutText = await this.page.locator('button:not(:has-text(""))').count();
    if (buttonsWithoutText === 0) {
      violations.push('Buttons without accessible text found');
    }
    
    return violations;
  }
}

// API helpers
export class ApiHelpers {
  constructor(private baseURL: string) {}
  
  async generateBookingToken(leadId: string, email: string): Promise<string> {
    const jwtService = new JWTService();
    const { accessToken } = await jwtService.generateBookingToken(
      leadId,
      email,
      { ipAddress: '127.0.0.1', userAgent: 'E2E Test' }
    );
    return accessToken;
  }
  
  async createWebhookPayload(data: Partial<any> = {}) {
    return {
      leadId: `e2e-lead-${Date.now()}`,
      ...generateTestData.lead(),
      ...generateTestData.booking(),
      source: 'gohighlevel',
      metadata: {
        test: true,
        timestamp: Date.now(),
      },
      ...data,
    };
  }
}

// Viewport helpers
export const viewports = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
  wide: { width: 1920, height: 1080 },
};

// Date helpers
export const dateHelpers = {
  formatDutchDate(date: Date): string {
    return new Intl.DateTimeFormat('nl-NL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  },
  
  getNextAvailableDate(daysFromNow: number = 7): Date {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    // Skip weekends
    while (date.getDay() === 0 || date.getDay() === 6) {
      date.setDate(date.getDate() + 1);
    }
    return date;
  },
  
  formatTimeSlot(hour: number): string {
    return `${hour.toString().padStart(2, '0')}:00`;
  },
};

// Assertion helpers
export const customExpect = {
  async toHaveValidationError(page: Page, field: string) {
    const errorElement = page.locator(`[data-error-for="${field}"], .error-${field}, #${field}-error`).first();
    await expect(errorElement).toBeVisible();
  },
  
  async toBeAccessible(page: Page) {
    const helpers = new PageHelpers(page);
    const violations = await helpers.checkAccessibility();
    expect(violations).toHaveLength(0);
  },
  
  async toHaveMetaTags(page: Page, tags: Record<string, string>) {
    for (const [name, content] of Object.entries(tags)) {
      const metaTag = page.locator(`meta[name="${name}"], meta[property="${name}"]`).first();
      await expect(metaTag).toHaveAttribute('content', content);
    }
  },
};

// Test data cleanup
export async function cleanupTestData(page: Page) {
  // This would typically call an API endpoint to clean up test data
  // For now, it's handled in global teardown
  console.log('Test data cleanup handled by global teardown');
}

// Mock data
export const mockData = {
  googleMapsPlace: {
    geometry: {
      location: {
        lat: () => 52.3676,
        lng: () => 4.9041,
      },
    },
    formatted_address: 'Damrak 1, 1012 LG Amsterdam, Netherlands',
    place_id: 'test-place-id',
    types: ['street_address'],
  },
  
  serviceTypes: [
    { value: 'onderhoud', label: 'Onderhoud' },
    { value: 'storing', label: 'Storing' },
    { value: 'installatie', label: 'Installatie' },
  ],
  
  timeSlots: [
    '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00',
  ],
};