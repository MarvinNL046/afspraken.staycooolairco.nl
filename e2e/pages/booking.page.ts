import { Page, Locator } from '@playwright/test';

export class BookingPage {
  readonly page: Page;
  readonly serviceSelector: Locator;
  readonly nextButton: Locator;
  readonly previousButton: Locator;
  readonly submitButton: Locator;
  
  // Address form
  readonly streetInput: Locator;
  readonly postalCodeInput: Locator;
  readonly cityInput: Locator;
  readonly addressValidated: Locator;
  
  // Date and time
  readonly dateSelector: Locator;
  readonly timeSlots: Locator;
  
  // Contact form
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly phoneInput: Locator;
  
  // Review
  readonly notesTextarea: Locator;
  readonly acceptTermsCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;
    
    // Navigation
    this.nextButton = page.locator('button:has-text("Next")');
    this.previousButton = page.locator('button:has-text("Previous")');
    this.submitButton = page.locator('button:has-text("Confirm Booking")');
    
    // Service selection
    this.serviceSelector = page.locator('[data-testid^="service-"]');
    
    // Address form
    this.streetInput = page.locator('input[name="street"]');
    this.postalCodeInput = page.locator('input[name="postalCode"]');
    this.cityInput = page.locator('input[name="city"]');
    this.addressValidated = page.locator('[data-testid="address-validated"]');
    
    // Date and time
    this.dateSelector = page.locator('[data-testid^="date-"]');
    this.timeSlots = page.locator('[data-testid^="time-slot-"]');
    
    // Contact form
    this.nameInput = page.locator('input[name="name"]');
    this.emailInput = page.locator('input[name="email"]');
    this.phoneInput = page.locator('input[name="phone"]');
    
    // Review
    this.notesTextarea = page.locator('textarea[name="notes"]');
    this.acceptTermsCheckbox = page.locator('input[name="acceptTerms"]');
  }

  async selectService(serviceType: string) {
    await this.page.locator(`[data-testid="service-${serviceType}"]`).click();
  }

  async clickNext() {
    await this.nextButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async clickPrevious() {
    await this.previousButton.click();
  }

  async fillAddress(address: { street: string; postalCode: string; city: string }) {
    await this.streetInput.fill(address.street);
    await this.postalCodeInput.fill(address.postalCode);
    await this.cityInput.fill(address.city);
    
    // Wait for address validation
    await this.page.waitForResponse(response => 
      response.url().includes('/api/validate-address') && response.status() === 200
    );
  }

  async selectFirstAvailableDate() {
    const availableDates = this.page.locator('[data-testid^="date-"][data-available="true"]');
    await availableDates.first().click();
  }

  async selectDate(date: string) {
    await this.page.locator(`[data-testid="date-${date}"]`).click();
  }

  async selectTimeSlot(time: string) {
    await this.page.locator(`[data-testid="time-slot-${time}"]`).click();
  }

  async fillContactDetails(contact: { name: string; email: string; phone: string }) {
    await this.nameInput.fill(contact.name);
    await this.emailInput.fill(contact.email);
    await this.phoneInput.fill(contact.phone);
  }

  async acceptTerms() {
    await this.acceptTermsCheckbox.check();
  }

  async fillNotes(notes: string) {
    await this.notesTextarea.fill(notes);
  }

  async submitBooking() {
    await this.submitButton.click();
    await this.page.waitForResponse(response => 
      response.url().includes('/api/appointments') && response.status() === 201
    );
  }

  async waitForSuccess() {
    await this.page.waitForSelector('[data-testid="booking-success"]', {
      state: 'visible',
      timeout: 10000,
    });
  }

  async getBookingReference(): Promise<string> {
    const referenceElement = this.page.locator('[data-testid="booking-reference"]');
    return await referenceElement.textContent() || '';
  }
}