/**
 * Contact Form Flow E2E Tests
 * 
 * Tests the contact form functionality on the home page
 */

import { test, expect } from '@playwright/test';
import { HomePage } from './pages/home.page';
import { generateTestData, PageHelpers } from './helpers/test-utils';

test.describe('Contact Form Flow', () => {
  let homePage: HomePage;
  let pageHelpers: PageHelpers;
  
  test.beforeEach(async ({ page }) => {
    homePage = new HomePage(page);
    pageHelpers = new PageHelpers(page);
    
    // Navigate to home page
    await homePage.goto();
  });
  
  test('should submit contact form successfully', async ({ page }) => {
    // Scroll to contact form
    await homePage.scrollToContact();
    
    // Generate test data
    const contactData = generateTestData.contact();
    
    // Fill contact form
    await homePage.fillContactForm(contactData);
    
    // Submit form
    await homePage.submitContactForm();
    
    // Wait for success message
    const successToast = await pageHelpers.waitForToast('Bedankt voor uw bericht');
    await expect(successToast).toBeVisible();
    
    // Form should be reset
    await expect(homePage.nameInput).toHaveValue('');
    await expect(homePage.emailInput).toHaveValue('');
    await expect(homePage.phoneInput).toHaveValue('');
    await expect(homePage.messageInput).toHaveValue('');
  });
  
  test('should validate required fields', async ({ page }) => {
    await homePage.scrollToContact();
    
    // Try to submit empty form
    await homePage.submitContactForm();
    
    // Check for validation errors
    await expect(page.locator('text=/verplicht|required/i').first()).toBeVisible();
    
    // Form should not be submitted
    const errorToast = page.locator('[role="alert"]');
    if (await errorToast.isVisible()) {
      const errorText = await errorToast.textContent();
      expect(errorText).toContain('Vul alle verplichte velden in');
    }
  });
  
  test('should validate email format', async ({ page }) => {
    await homePage.scrollToContact();
    
    // Fill form with invalid email
    await homePage.fillContactForm({
      naam: 'Test User',
      email: 'invalid-email',
      telefoon: '0612345678',
      bericht: 'This is a test message',
    });
    
    await homePage.submitContactForm();
    
    // Check for email validation error
    const emailError = page.locator('text=/ongeldig.*email|email.*ongeldig/i');
    await expect(emailError).toBeVisible();
  });
  
  test('should validate phone number format', async ({ page }) => {
    await homePage.scrollToContact();
    
    // Fill form with invalid phone
    await homePage.fillContactForm({
      naam: 'Test User',
      email: 'test@example.com',
      telefoon: '123',
      bericht: 'This is a test message',
    });
    
    await homePage.submitContactForm();
    
    // Check for phone validation error
    const phoneError = page.locator('text=/ongeldig.*telefoon|telefoon.*ongeldig/i');
    await expect(phoneError).toBeVisible();
  });
  
  test('should validate message length', async ({ page }) => {
    await homePage.scrollToContact();
    
    // Fill form with short message
    await homePage.fillContactForm({
      naam: 'Test User',
      email: 'test@example.com',
      telefoon: '0612345678',
      bericht: 'Hi',
    });
    
    await homePage.submitContactForm();
    
    // Check for message length error
    const messageError = page.locator('text=/minimaal.*10|10.*karakters/i');
    await expect(messageError).toBeVisible();
  });
  
  test('should handle network errors gracefully', async ({ page, context }) => {
    await homePage.scrollToContact();
    
    // Block API requests
    await context.route('**/api/contact', route => {
      route.abort('failed');
    });
    
    // Fill and submit form
    const contactData = generateTestData.contact();
    await homePage.fillContactForm(contactData);
    await homePage.submitContactForm();
    
    // Should show error message
    const errorToast = await pageHelpers.waitForToast('Er is een fout opgetreden');
    await expect(errorToast).toBeVisible();
    
    // Form data should be preserved
    await expect(homePage.nameInput).toHaveValue(contactData.naam);
    await expect(homePage.emailInput).toHaveValue(contactData.email);
  });
  
  test('should prevent XSS attacks', async ({ page }) => {
    await homePage.scrollToContact();
    
    // Try to submit form with XSS payload
    await homePage.fillContactForm({
      naam: 'Test<script>alert("XSS")</script>User',
      email: 'test@example.com',
      telefoon: '0612345678',
      bericht: '<img src=x onerror=alert("XSS")>This is a test message',
    });
    
    await homePage.submitContactForm();
    
    // If form is submitted, it should be sanitized
    // If blocked, should show security error
    const response = await page.waitForResponse(
      response => response.url().includes('/api/contact'),
      { timeout: 5000 }
    ).catch(() => null);
    
    if (response) {
      const status = response.status();
      if (status === 400) {
        const errorToast = await pageHelpers.waitForToast('beveiligingsredenen');
        await expect(errorToast).toBeVisible();
      }
    }
  });
  
  test('should be accessible', async ({ page }) => {
    await homePage.scrollToContact();
    
    // Check form accessibility
    const formAccessibility = await page.accessibility.snapshot();
    expect(formAccessibility).toBeTruthy();
    
    // Check for form labels
    const nameLabel = await page.locator('label[for="naam"]').textContent();
    const emailLabel = await page.locator('label[for="email"]').textContent();
    const phoneLabel = await page.locator('label[for="telefoon"]').textContent();
    const messageLabel = await page.locator('label[for="bericht"]').textContent();
    
    expect(nameLabel).toBeTruthy();
    expect(emailLabel).toBeTruthy();
    expect(phoneLabel).toBeTruthy();
    expect(messageLabel).toBeTruthy();
    
    // Check for ARIA attributes
    await expect(homePage.submitButton).toHaveAttribute('type', 'submit');
    
    // Check color contrast
    const submitButtonColor = await homePage.submitButton.evaluate(el => {
      const styles = window.getComputedStyle(el);
      return {
        color: styles.color,
        backgroundColor: styles.backgroundColor,
      };
    });
    
    // Button should have sufficient contrast
    expect(submitButtonColor.color).toBeTruthy();
    expect(submitButtonColor.backgroundColor).toBeTruthy();
  });
  
  test('should work on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Navigate and scroll to form
    await homePage.goto();
    await homePage.scrollToContact();
    
    // Form should be visible
    await expect(homePage.contactForm).toBeVisible();
    
    // Fill and submit form
    const contactData = generateTestData.contact();
    await homePage.fillContactForm(contactData);
    await homePage.submitContactForm();
    
    // Should work on mobile
    const successToast = await pageHelpers.waitForToast('Bedankt voor uw bericht');
    await expect(successToast).toBeVisible();
  });
  
  test('should handle rapid submissions', async ({ page }) => {
    await homePage.scrollToContact();
    
    const contactData = generateTestData.contact();
    await homePage.fillContactForm(contactData);
    
    // Click submit multiple times rapidly
    await homePage.submitButton.click({ clickCount: 3, delay: 100 });
    
    // Should only submit once
    let requestCount = 0;
    page.on('request', request => {
      if (request.url().includes('/api/contact')) {
        requestCount++;
      }
    });
    
    // Wait for any requests to complete
    await page.waitForTimeout(2000);
    
    // Should have made only one request
    expect(requestCount).toBeLessThanOrEqual(1);
  });
  
  test('should show loading state during submission', async ({ page }) => {
    await homePage.scrollToContact();
    
    // Slow down the API response
    await page.route('**/api/contact', async route => {
      await page.waitForTimeout(1000);
      await route.continue();
    });
    
    const contactData = generateTestData.contact();
    await homePage.fillContactForm(contactData);
    
    // Submit form
    const submitPromise = homePage.submitContactForm();
    
    // Button should show loading state
    await expect(homePage.submitButton).toBeDisabled();
    const buttonText = await homePage.submitButton.textContent();
    expect(buttonText).toMatch(/verzenden|bezig|loading/i);
    
    await submitPromise;
  });
});