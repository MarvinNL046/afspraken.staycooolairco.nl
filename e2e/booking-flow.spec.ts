/**
 * Booking Flow E2E Tests
 * 
 * Tests the complete booking flow from webhook to appointment confirmation
 */

import { test, expect } from '@playwright/test';
import { BookingPage } from './pages/booking.page';
import { HomePage } from './pages/home.page';
import { generateTestData, ApiHelpers, dateHelpers } from './helpers/test-utils';

test.describe('Booking Flow', () => {
  let bookingPage: BookingPage;
  let homePage: HomePage;
  let apiHelpers: ApiHelpers;
  
  test.beforeEach(async ({ page, baseURL }) => {
    bookingPage = new BookingPage(page);
    homePage = new HomePage(page);
    apiHelpers = new ApiHelpers(baseURL || 'http://localhost:3000');
  });
  
  test('should complete booking flow with valid token', async ({ page }) => {
    // Generate test data
    const leadData = generateTestData.lead();
    const bookingData = generateTestData.booking();
    
    // Generate a valid JWT token
    const token = await apiHelpers.generateBookingToken('e2e-test-lead', leadData.email);
    
    // Navigate to booking page with token
    await bookingPage.goto(token);
    await bookingPage.waitForFormReady();
    
    // Fill out the booking form
    await bookingPage.fillCompleteBookingForm({
      ...leadData,
      ...bookingData,
      datum: dateHelpers.getNextAvailableDate(14),
    });
    
    // Submit the form
    await bookingPage.submitForm();
    
    // Wait for success
    await bookingPage.waitForSuccess();
    const successMessage = await bookingPage.getSuccessMessage();
    
    // Verify success message
    expect(successMessage).toContain('Uw afspraak is bevestigd');
    
    // Take screenshot of confirmation
    await page.screenshot({ 
      path: 'test-results/booking-confirmation.png',
      fullPage: true 
    });
  });
  
  test('should show error for invalid token', async ({ page }) => {
    // Navigate with invalid token
    await bookingPage.goto('invalid-token-12345');
    
    // Should show error
    await bookingPage.waitForError();
    const errorMessage = await bookingPage.getErrorMessage();
    
    expect(errorMessage).toContain('Ongeldige of verlopen sessie');
  });
  
  test('should validate required fields', async ({ page }) => {
    // Generate valid token
    const token = await apiHelpers.generateBookingToken('e2e-test-lead', 'test@example.com');
    await bookingPage.goto(token);
    await bookingPage.waitForFormReady();
    
    // Try to submit empty form
    await bookingPage.submitForm();
    
    // Check validation errors
    const nameError = await bookingPage.checkFieldValidation('naam');
    const emailError = await bookingPage.checkFieldValidation('email');
    const phoneError = await bookingPage.checkFieldValidation('telefoon');
    
    expect(nameError).toBe(true);
    expect(emailError).toBe(true);
    expect(phoneError).toBe(true);
  });
  
  test('should validate email format', async ({ page }) => {
    const token = await apiHelpers.generateBookingToken('e2e-test-lead', 'test@example.com');
    await bookingPage.goto(token);
    await bookingPage.waitForFormReady();
    
    // Fill invalid email
    await bookingPage.emailInput.fill('invalid-email');
    await bookingPage.submitForm();
    
    // Check email validation
    const emailError = await bookingPage.getFieldError('email');
    expect(emailError).toContain('Ongeldig e-mailadres');
  });
  
  test('should validate phone number format', async ({ page }) => {
    const token = await apiHelpers.generateBookingToken('e2e-test-lead', 'test@example.com');
    await bookingPage.goto(token);
    await bookingPage.waitForFormReady();
    
    // Fill invalid phone
    await bookingPage.phoneInput.fill('123');
    await bookingPage.submitForm();
    
    // Check phone validation
    const phoneError = await bookingPage.getFieldError('telefoon');
    expect(phoneError).toContain('Ongeldig telefoonnummer');
  });
  
  test('should validate postal code format', async ({ page }) => {
    const token = await apiHelpers.generateBookingToken('e2e-test-lead', 'test@example.com');
    await bookingPage.goto(token);
    await bookingPage.waitForFormReady();
    
    // Fill invalid postal code
    await bookingPage.postalCodeInput.fill('12345');
    await bookingPage.submitForm();
    
    // Check postal code validation
    const postalError = await bookingPage.getFieldError('postcode');
    expect(postalError).toContain('Ongeldige postcode');
  });
  
  test('should not allow past dates', async ({ page }) => {
    const token = await apiHelpers.generateBookingToken('e2e-test-lead', 'test@example.com');
    await bookingPage.goto(token);
    await bookingPage.waitForFormReady();
    
    // Try to select past date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    await bookingPage.dateInput.click();
    await bookingPage.calendar.waitFor({ state: 'visible' });
    
    // Past dates should be disabled
    const pastDayButton = bookingPage.calendarDays.filter({ 
      hasText: yesterday.getDate().toString() 
    }).first();
    
    const isDisabled = await pastDayButton.isDisabled();
    expect(isDisabled).toBe(true);
  });
  
  test('should show available time slots', async ({ page }) => {
    const token = await apiHelpers.generateBookingToken('e2e-test-lead', 'test@example.com');
    await bookingPage.goto(token);
    await bookingPage.waitForFormReady();
    
    // Get available time slots
    const timeSlots = await bookingPage.getAvailableTimeSlots();
    
    // Should have time slots
    expect(timeSlots.length).toBeGreaterThan(0);
    expect(timeSlots).toContain('10:00');
    expect(timeSlots).toContain('14:00');
  });
  
  test('should handle booking from home page CTA', async ({ page }) => {
    // Start from home page
    await homePage.goto();
    
    // Click CTA button
    await homePage.navigateToBooking();
    
    // Should redirect to booking page
    await expect(page).toHaveURL(/\/booking/);
    
    // Should show message about needing a booking link
    const message = page.locator('text=/booking link|afspraak link/i');
    await expect(message).toBeVisible();
  });
  
  test('should preserve form data on validation error', async ({ page }) => {
    const token = await apiHelpers.generateBookingToken('e2e-test-lead', 'test@example.com');
    await bookingPage.goto(token);
    await bookingPage.waitForFormReady();
    
    // Fill partial form with invalid data
    await bookingPage.fillPersonalInfo({
      naam: 'Test User',
      email: 'invalid-email',
      telefoon: '0612345678',
    });
    
    await bookingPage.fillAddress({
      adres: 'Teststraat 123',
      stad: 'Amsterdam',
      postcode: '1234AB',
    });
    
    // Submit form
    await bookingPage.submitForm();
    
    // Check that valid data is preserved
    expect(await bookingPage.nameInput.inputValue()).toBe('Test User');
    expect(await bookingPage.phoneInput.inputValue()).toBe('0612345678');
    expect(await bookingPage.addressInput.inputValue()).toBe('Teststraat 123');
  });
  
  test('should be accessible', async ({ page }) => {
    const token = await apiHelpers.generateBookingToken('e2e-test-lead', 'test@example.com');
    await bookingPage.goto(token);
    await bookingPage.waitForFormReady();
    
    // Check for accessibility issues
    const accessibilityReport = await page.accessibility.snapshot();
    expect(accessibilityReport).toBeTruthy();
    
    // Check form labels
    const inputs = ['naam', 'email', 'telefoon', 'adres', 'stad', 'postcode'];
    for (const inputName of inputs) {
      const input = page.locator(`[name="${inputName}"]`);
      const label = await input.getAttribute('aria-label') || 
                   await page.locator(`label[for="${inputName}"]`).textContent();
      expect(label).toBeTruthy();
    }
  });
  
  test('should work on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    const token = await apiHelpers.generateBookingToken('e2e-test-lead', 'test@example.com');
    await bookingPage.goto(token);
    await bookingPage.waitForFormReady();
    
    // Form should be visible and functional
    await expect(bookingPage.bookingForm).toBeVisible();
    
    // Fill and submit form
    const testData = {
      ...generateTestData.lead(),
      ...generateTestData.booking(),
      datum: dateHelpers.getNextAvailableDate(7),
    };
    
    await bookingPage.fillCompleteBookingForm(testData);
    await bookingPage.submitForm();
    
    // Should work on mobile
    await bookingPage.waitForSuccess();
  });
});