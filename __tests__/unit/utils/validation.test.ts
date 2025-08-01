import { describe, it, expect } from '@jest/globals';
import {
  validateEmail,
  validatePhoneNumber,
  validatePostalCode,
  validatePassword,
  validateServiceType,
  validateDateRange,
  sanitizeInput,
} from '@/lib/utils/validation';

describe('Validation Utils', () => {
  describe('validateEmail', () => {
    it('should validate correct email formats', () => {
      const validEmails = [
        'test@example.com',
        'user.name@company.nl',
        'info+tag@staycoolairco.nl',
        'test_123@sub.domain.com',
      ];

      validEmails.forEach(email => {
        expect(validateEmail(email)).toBe(true);
      });
    });

    it('should reject invalid email formats', () => {
      const invalidEmails = [
        'notanemail',
        '@example.com',
        'test@',
        'test @example.com',
        'test@example',
        '',
        null,
        undefined,
      ];

      invalidEmails.forEach(email => {
        expect(validateEmail(email as any)).toBe(false);
      });
    });
  });

  describe('validatePhoneNumber', () => {
    it('should validate Dutch phone numbers', () => {
      const validNumbers = [
        '0612345678',
        '06-12345678',
        '06 12 34 56 78',
        '+31612345678',
        '+31 6 12345678',
        '0201234567',
        '020-1234567',
      ];

      validNumbers.forEach(number => {
        expect(validatePhoneNumber(number)).toBe(true);
      });
    });

    it('should reject invalid phone numbers', () => {
      const invalidNumbers = [
        '12345',
        'abcdefghij',
        '061234567', // Too short
        '06123456789', // Too long
        '+32612345678', // Wrong country code
        '',
      ];

      invalidNumbers.forEach(number => {
        expect(validatePhoneNumber(number)).toBe(false);
      });
    });
  });

  describe('validatePostalCode', () => {
    it('should validate Dutch postal codes', () => {
      const validCodes = [
        '1234AB',
        '1234 AB',
        '9999ZZ',
        '1000AA',
      ];

      validCodes.forEach(code => {
        expect(validatePostalCode(code)).toBe(true);
      });
    });

    it('should reject invalid postal codes', () => {
      const invalidCodes = [
        '123AB', // Too short
        '12345AB', // Too long
        '1234A', // Missing letter
        '1234ABC', // Too many letters
        'ABCDEG', // No numbers
        '1234-AB', // Invalid separator
        '',
      ];

      invalidCodes.forEach(code => {
        expect(validatePostalCode(code)).toBe(false);
      });
    });

    it('should normalize postal codes', () => {
      expect(validatePostalCode('1234ab')).toBe(true); // Lowercase
      expect(validatePostalCode(' 1234 AB ')).toBe(true); // Extra spaces
    });
  });

  describe('validatePassword', () => {
    it('should validate strong passwords', () => {
      const validPasswords = [
        'Test123!',
        'P@ssw0rd',
        'SecurePass123$',
        'Complex!ty8',
      ];

      validPasswords.forEach(password => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject weak passwords with specific errors', () => {
      const testCases = [
        {
          password: 'short',
          expectedErrors: ['Password must be at least 8 characters long'],
        },
        {
          password: 'nouppercase123!',
          expectedErrors: ['Password must contain at least one uppercase letter'],
        },
        {
          password: 'NOLOWERCASE123!',
          expectedErrors: ['Password must contain at least one lowercase letter'],
        },
        {
          password: 'NoNumbers!',
          expectedErrors: ['Password must contain at least one number'],
        },
        {
          password: 'NoSpecial123',
          expectedErrors: ['Password must contain at least one special character'],
        },
        {
          password: '',
          expectedErrors: [
            'Password must be at least 8 characters long',
            'Password must contain at least one uppercase letter',
            'Password must contain at least one lowercase letter',
            'Password must contain at least one number',
            'Password must contain at least one special character',
          ],
        },
      ];

      testCases.forEach(({ password, expectedErrors }) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.errors).toEqual(expectedErrors);
      });
    });

    it('should calculate password strength', () => {
      expect(validatePassword('Test123!').strength).toBe('medium');
      expect(validatePassword('Test123!@#$').strength).toBe('strong');
      expect(validatePassword('Test123!@#$ExtraLong').strength).toBe('very strong');
    });
  });

  describe('validateServiceType', () => {
    it('should validate known service types', () => {
      const validTypes = [
        'AC_INSTALLATION',
        'AC_MAINTENANCE',
        'AC_REPAIR',
        'HEAT_PUMP_INSTALLATION',
        'EMERGENCY_REPAIR',
      ];

      validTypes.forEach(type => {
        expect(validateServiceType(type)).toBe(true);
      });
    });

    it('should reject unknown service types', () => {
      const invalidTypes = [
        'UNKNOWN_SERVICE',
        'ac_installation', // Wrong case
        'AC INSTALLATION', // Space instead of underscore
        '',
        null,
        undefined,
      ];

      invalidTypes.forEach(type => {
        expect(validateServiceType(type as any)).toBe(false);
      });
    });
  });

  describe('validateDateRange', () => {
    it('should validate valid date ranges', () => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      expect(validateDateRange(tomorrow, nextWeek)).toBe(true);
      expect(validateDateRange(now, tomorrow)).toBe(true);
    });

    it('should reject invalid date ranges', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Start date after end date
      expect(validateDateRange(now, yesterday)).toBe(false);
      
      // Dates in the past
      expect(validateDateRange(lastWeek, yesterday)).toBe(false);
      
      // Invalid date objects
      expect(validateDateRange(new Date('invalid'), now)).toBe(false);
      expect(validateDateRange(now, new Date('invalid'))).toBe(false);
    });

    it('should validate business hours', () => {
      const date = new Date('2024-01-15T10:00:00');
      const earlyMorning = new Date('2024-01-15T06:00:00');
      const lateEvening = new Date('2024-01-15T22:00:00');

      expect(validateDateRange(date, date, { businessHours: true })).toBe(true);
      expect(validateDateRange(earlyMorning, earlyMorning, { businessHours: true })).toBe(false);
      expect(validateDateRange(lateEvening, lateEvening, { businessHours: true })).toBe(false);
    });
  });

  describe('sanitizeInput', () => {
    it('should remove dangerous HTML and scripts', () => {
      const inputs = [
        {
          input: '<script>alert("XSS")</script>Hello',
          expected: 'Hello',
        },
        {
          input: 'Hello <b>World</b>',
          expected: 'Hello World',
        },
        {
          input: '<img src=x onerror=alert("XSS")>',
          expected: '',
        },
        {
          input: 'Normal text with no HTML',
          expected: 'Normal text with no HTML',
        },
      ];

      inputs.forEach(({ input, expected }) => {
        expect(sanitizeInput(input)).toBe(expected);
      });
    });

    it('should handle special characters', () => {
      const input = 'Test & < > " \' characters';
      const sanitized = sanitizeInput(input);
      expect(sanitized).not.toContain('<');
      expect(sanitized).not.toContain('>');
    });

    it('should trim whitespace', () => {
      expect(sanitizeInput('  Hello World  ')).toBe('Hello World');
      expect(sanitizeInput('\n\tText\n\t')).toBe('Text');
    });

    it('should handle null and undefined', () => {
      expect(sanitizeInput(null as any)).toBe('');
      expect(sanitizeInput(undefined as any)).toBe('');
    });
  });
});