import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility Tests', () => {
  test('homepage should have no accessibility violations', async ({ page }) => {
    await page.goto('/');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('booking flow should be keyboard navigable', async ({ page }) => {
    await page.goto('/booking');
    
    // Test keyboard navigation
    await page.keyboard.press('Tab');
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeTruthy();
    
    // Navigate through form with keyboard
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
    }
    
    // Select service with keyboard
    await page.keyboard.press('Space');
    
    // Check focus is still trackable
    const currentFocus = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    expect(currentFocus).toBeTruthy();
  });

  test('form inputs should have proper labels', async ({ page }) => {
    await page.goto('/booking');
    
    // Check all inputs have associated labels
    const inputs = await page.locator('input:not([type="hidden"])').all();
    
    for (const input of inputs) {
      const inputId = await input.getAttribute('id');
      const inputName = await input.getAttribute('name');
      
      // Check for label association
      const hasLabel = await page.locator(`label[for="${inputId}"]`).count() > 0 ||
                      await input.getAttribute('aria-label') !== null ||
                      await input.getAttribute('aria-labelledby') !== null;
      
      expect(hasLabel).toBeTruthy();
    }
  });

  test('images should have alt text', async ({ page }) => {
    await page.goto('/');
    
    const images = await page.locator('img').all();
    
    for (const img of images) {
      const alt = await img.getAttribute('alt');
      const role = await img.getAttribute('role');
      
      // Images should have alt text unless they're decorative (role="presentation")
      if (role !== 'presentation' && role !== 'none') {
        expect(alt).toBeTruthy();
        expect(alt?.length).toBeGreaterThan(0);
      }
    }
  });

  test('page should have proper heading structure', async ({ page }) => {
    await page.goto('/');
    
    // Check for h1
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
    
    // Check heading hierarchy
    const headings = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      return elements.map(el => ({
        level: parseInt(el.tagName[1]),
        text: el.textContent?.trim()
      }));
    });
    
    // Verify no heading levels are skipped
    let previousLevel = 0;
    for (const heading of headings) {
      expect(heading.level - previousLevel).toBeLessThanOrEqual(1);
      if (heading.level > previousLevel) {
        previousLevel = heading.level;
      }
    }
  });

  test('interactive elements should have focus indicators', async ({ page }) => {
    await page.goto('/');
    
    // Get all interactive elements
    const interactiveElements = await page.locator('button, a, input, select, textarea').all();
    
    for (const element of interactiveElements.slice(0, 5)) { // Test first 5 elements
      await element.focus();
      
      // Check if element has focus styles
      const hasFocusStyles = await element.evaluate(el => {
        const styles = window.getComputedStyle(el);
        const focusStyles = styles.getPropertyValue('outline') || 
                           styles.getPropertyValue('box-shadow') ||
                           styles.getPropertyValue('border');
        return focusStyles !== 'none' && focusStyles !== '';
      });
      
      expect(hasFocusStyles).toBeTruthy();
    }
  });

  test('color contrast should meet WCAG standards', async ({ page }) => {
    await page.goto('/');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2aa'])
      .include('.text-content') // Scan text content areas
      .analyze();

    const colorContrastViolations = accessibilityScanResults.violations.filter(
      violation => violation.id === 'color-contrast'
    );
    
    expect(colorContrastViolations).toHaveLength(0);
  });

  test('forms should have proper error messages', async ({ page }) => {
    await page.goto('/booking');
    
    // Skip to contact form
    await page.locator('[data-testid="service-AC_REPAIR"]').click();
    await page.locator('button:has-text("Next")').click();
    
    // Fill address
    await page.fill('input[name="street"]', 'Test Street 1');
    await page.fill('input[name="postalCode"]', '1000AA');
    await page.fill('input[name="city"]', 'Amsterdam');
    await page.locator('button:has-text("Next")').click();
    
    // Select date and time
    await page.locator('[data-testid^="date-"]:first-child').click();
    await page.locator('[data-testid^="time-slot-"]:first-child').click();
    await page.locator('button:has-text("Next")').click();
    
    // Try to submit without filling required fields
    await page.locator('button:has-text("Next")').click();
    
    // Check error messages are associated with inputs
    const errorMessages = await page.locator('[role="alert"], [aria-live="polite"]').all();
    expect(errorMessages.length).toBeGreaterThan(0);
    
    // Check inputs have aria-invalid
    const invalidInputs = await page.locator('input[aria-invalid="true"]').all();
    expect(invalidInputs.length).toBeGreaterThan(0);
    
    // Check error messages are announced
    for (const error of errorMessages) {
      const ariaLive = await error.getAttribute('aria-live');
      expect(['polite', 'assertive']).toContain(ariaLive);
    }
  });

  test('mobile menu should be accessible', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile only test');
    
    await page.goto('/');
    
    // Check mobile menu button has proper attributes
    const menuButton = page.locator('[data-testid="mobile-menu-toggle"]');
    const ariaExpanded = await menuButton.getAttribute('aria-expanded');
    expect(ariaExpanded).toBe('false');
    
    // Open menu
    await menuButton.click();
    const ariaExpandedAfter = await menuButton.getAttribute('aria-expanded');
    expect(ariaExpandedAfter).toBe('true');
    
    // Check menu is keyboard navigable
    await page.keyboard.press('Tab');
    const focusedInMenu = await page.evaluate(() => {
      const activeElement = document.activeElement;
      return activeElement?.closest('[role="navigation"]') !== null;
    });
    expect(focusedInMenu).toBeTruthy();
  });

  test('loading states should be announced', async ({ page }) => {
    await page.goto('/booking');
    
    // Select service and go to address step
    await page.locator('[data-testid="service-AC_INSTALLATION"]').click();
    await page.locator('button:has-text("Next")').click();
    
    // Fill address to trigger validation
    await page.fill('input[name="street"]', 'Damrak 70');
    await page.fill('input[name="postalCode"]', '1012LM');
    await page.fill('input[name="city"]', 'Amsterdam');
    
    // Check for loading announcement
    const loadingIndicator = page.locator('[role="status"], [aria-busy="true"]');
    await expect(loadingIndicator).toBeVisible();
    
    // Verify loading indicator has proper text for screen readers
    const ariaLabel = await loadingIndicator.getAttribute('aria-label');
    expect(ariaLabel).toContain('loading');
  });
});