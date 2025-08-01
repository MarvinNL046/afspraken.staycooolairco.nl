/**
 * Input Validation Middleware Unit Tests
 * 
 * Tests input validation, sanitization, and security measures
 */

import { 
  validateBookingInput,
  validateWebhookInput,
  validateContactInput,
  sanitizeInput,
  createValidationMiddleware,
  bookingSchema,
  webhookSchema,
  contactSchema,
} from '@/lib/middleware/input-validation';
import { z } from 'zod';
import { AppError, ErrorCode } from '@/lib/errors/types';

// Mock DOMPurify
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: {
    sanitize: jest.fn((input: string) => {
      // Simple mock sanitization - remove script tags
      return input.replace(/<script[^>]*>.*?<\/script>/gi, '');
    }),
  },
}));

describe('Input Validation Middleware', () => {
  describe('sanitizeInput', () => {
    it('should sanitize strings', () => {
      const input = 'Hello <script>alert("XSS")</script>World';
      const result = sanitizeInput(input);
      expect(result).toBe('Hello World');
    });

    it('should sanitize nested objects', () => {
      const input = {
        name: 'Test <script>alert("XSS")</script>User',
        address: {
          street: 'Main <b>Street</b> 123',
          city: 'Amsterdam<script>evil()</script>',
        },
      };

      const result = sanitizeInput(input);
      expect(result).toEqual({
        name: 'Test User',
        address: {
          street: 'Main <b>Street</b> 123',
          city: 'Amsterdam',
        },
      });
    });

    it('should handle arrays', () => {
      const input = ['Safe', '<script>alert("XSS")</script>Dangerous', 'Normal'];
      const result = sanitizeInput(input);
      expect(result).toEqual(['Safe', 'Dangerous', 'Normal']);
    });

    it('should preserve non-string values', () => {
      const input = {
        name: 'Test',
        age: 25,
        active: true,
        data: null,
        timestamp: new Date('2024-01-01'),
      };

      const result = sanitizeInput(input);
      expect(result).toEqual(input);
    });
  });

  describe('validateBookingInput', () => {
    const validBooking = {
      naam: 'John Doe',
      email: 'john@example.com',
      telefoon: '0612345678',
      adres: 'Main Street 123',
      stad: 'Amsterdam',
      postcode: '1234AB',
      datum: '2024-12-25',
      tijd: '10:00',
      serviceType: 'onderhoud',
      vraag: 'Test question',
      token: 'valid.jwt.token',
    };

    it('should validate correct booking input', async () => {
      const result = await validateBookingInput(validBooking);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validBooking);
    });

    it('should reject invalid email', async () => {
      const invalid = { ...validBooking, email: 'not-an-email' };
      const result = await validateBookingInput(invalid);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toContain('email');
    });

    it('should reject invalid phone number', async () => {
      const invalid = { ...validBooking, telefoon: '123' };
      const result = await validateBookingInput(invalid);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toContain('telefoon');
    });

    it('should reject invalid postcode', async () => {
      const invalid = { ...validBooking, postcode: '12345' };
      const result = await validateBookingInput(invalid);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toContain('postcode');
    });

    it('should reject invalid service type', async () => {
      const invalid = { ...validBooking, serviceType: 'invalid' };
      const result = await validateBookingInput(invalid);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toContain('serviceType');
    });

    it('should reject past dates', async () => {
      const invalid = { ...validBooking, datum: '2020-01-01' };
      const result = await validateBookingInput(invalid);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('verleden');
    });

    it('should reject invalid time format', async () => {
      const invalid = { ...validBooking, tijd: '25:00' };
      const result = await validateBookingInput(invalid);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toContain('tijd');
    });

    it('should sanitize string inputs', async () => {
      const malicious = {
        ...validBooking,
        naam: 'John<script>alert("XSS")</script>Doe',
        vraag: 'Question<script>evil()</script>',
      };
      const result = await validateBookingInput(malicious);
      expect(result.success).toBe(true);
      expect(result.data?.naam).toBe('JohnDoe');
      expect(result.data?.vraag).toBe('Question');
    });
  });

  describe('validateWebhookInput', () => {
    const validWebhook = {
      leadId: 'lead-123',
      email: 'test@example.com',
      naam: 'Test User',
      telefoon: '0612345678',
      adres: 'Test Street 123',
      stad: 'Amsterdam',
      postcode: '1234AB',
      datum: '2024-12-25',
      tijd: '14:00',
      serviceType: 'storing',
      vraag: 'Help needed',
      source: 'gohighlevel',
      metadata: {
        campaign: 'test',
        referrer: 'google',
      },
    };

    it('should validate correct webhook input', async () => {
      const result = await validateWebhookInput(validWebhook);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validWebhook);
    });

    it('should require leadId', async () => {
      const invalid = { ...validWebhook };
      delete (invalid as any).leadId;
      const result = await validateWebhookInput(invalid);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toContain('leadId');
    });

    it('should allow optional metadata', async () => {
      const noMetadata = { ...validWebhook };
      delete noMetadata.metadata;
      const result = await validateWebhookInput(noMetadata);
      expect(result.success).toBe(true);
    });

    it('should validate metadata structure', async () => {
      const invalidMetadata = {
        ...validWebhook,
        metadata: 'not an object',
      };
      const result = await validateWebhookInput(invalidMetadata);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toContain('metadata');
    });
  });

  describe('validateContactInput', () => {
    const validContact = {
      naam: 'John Doe',
      email: 'john@example.com',
      telefoon: '0612345678',
      bericht: 'Test message',
    };

    it('should validate correct contact input', async () => {
      const result = await validateContactInput(validContact);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validContact);
    });

    it('should enforce minimum message length', async () => {
      const invalid = { ...validContact, bericht: 'Hi' };
      const result = await validateContactInput(invalid);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('minimaal 10');
    });

    it('should enforce maximum message length', async () => {
      const invalid = { ...validContact, bericht: 'A'.repeat(1001) };
      const result = await validateContactInput(invalid);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('maximaal 1000');
    });

    it('should sanitize message content', async () => {
      const malicious = {
        ...validContact,
        bericht: 'Hello<script>alert("XSS")</script> World! This is a test message.',
      };
      const result = await validateContactInput(malicious);
      expect(result.success).toBe(true);
      expect(result.data?.bericht).toBe('Hello World! This is a test message.');
    });
  });

  describe('createValidationMiddleware', () => {
    const testSchema = z.object({
      name: z.string().min(1),
      age: z.number().min(0).max(150),
    });

    const middleware = createValidationMiddleware(testSchema);

    it('should pass valid data to next handler', async () => {
      const req = {
        body: { name: 'Test', age: 25 },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body).toEqual({ name: 'Test', age: 25 });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid data', async () => {
      const req = {
        body: { name: '', age: 200 },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Validation Error',
        details: expect.any(Array),
      });
    });

    it('should sanitize string fields', async () => {
      const req = {
        body: { 
          name: 'Test<script>alert("XSS")</script>User', 
          age: 25 
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body.name).toBe('TestUser');
    });

    it('should handle missing body', async () => {
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await middleware(req as any, res as any, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Schema Validation Rules', () => {
    describe('bookingSchema', () => {
      it('should validate all required fields', () => {
        const result = bookingSchema.safeParse({});
        expect(result.success).toBe(false);
        const paths = result.error?.issues.map(i => i.path[0]);
        expect(paths).toContain('naam');
        expect(paths).toContain('email');
        expect(paths).toContain('telefoon');
        expect(paths).toContain('adres');
        expect(paths).toContain('stad');
        expect(paths).toContain('postcode');
        expect(paths).toContain('datum');
        expect(paths).toContain('tijd');
        expect(paths).toContain('serviceType');
        expect(paths).toContain('token');
      });
    });

    describe('webhookSchema', () => {
      it('should validate required fields', () => {
        const result = webhookSchema.safeParse({});
        expect(result.success).toBe(false);
        const paths = result.error?.issues.map(i => i.path[0]);
        expect(paths).toContain('leadId');
        expect(paths).toContain('email');
      });

      it('should allow valid sources', () => {
        const validSources = ['gohighlevel', 'website', 'api'];
        validSources.forEach(source => {
          const result = webhookSchema.safeParse({
            leadId: 'test',
            email: 'test@example.com',
            source,
          });
          expect(result.success).toBe(true);
        });
      });
    });

    describe('contactSchema', () => {
      it('should validate all required fields', () => {
        const result = contactSchema.safeParse({});
        expect(result.success).toBe(false);
        const paths = result.error?.issues.map(i => i.path[0]);
        expect(paths).toContain('naam');
        expect(paths).toContain('email');
        expect(paths).toContain('telefoon');
        expect(paths).toContain('bericht');
      });
    });
  });
});