import { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly bookNowButton: Locator;
  readonly servicesSection: Locator;
  readonly heroTitle: Locator;
  readonly mobileMenuToggle: Locator;
  readonly mobileBookNowButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.bookNowButton = page.locator('[data-testid="book-now-cta"]');
    this.servicesSection = page.locator('[data-testid="services-section"]');
    this.heroTitle = page.locator('h1');
    this.mobileMenuToggle = page.locator('[data-testid="mobile-menu-toggle"]');
    this.mobileBookNowButton = page.locator('[data-testid="mobile-book-now"]');
  }

  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  async clickBookNow() {
    await this.bookNowButton.click();
  }

  async scrollToServices() {
    await this.servicesSection.scrollIntoViewIfNeeded();
  }

  async openMobileMenu() {
    await this.mobileMenuToggle.click();
  }

  async clickMobileBookNow() {
    await this.openMobileMenu();
    await this.mobileBookNowButton.click();
  }
}