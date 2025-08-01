/**
 * Contact API Integration Tests
 * 
 * Tests the contact form API endpoint with database and service integration
 */

import { NextRequest } from 'next/server';
import { POST as contactHandler } from '@/app/api/contact/route';
import { prismaMock } from '@/jest.setup.integration';
import { EmailService } from '@/lib/services/email';
import { ErrorCode } from '@/lib/errors/types';

// Mock services
jest.mock('@/lib/services/email');

describe('Contact API Integration', () => {
  let mockEmailService: jest.Mocked<EmailService>;

  const validContactData = {
    naam: 'Jane Doe',
    email: 'jane@example.com',
    telefoon: '0687654321',
    bericht: 'Ik heb een vraag over jullie airco installatie diensten.',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up email service mock
    mockEmailService = {
      sendContactFormEmail: jest.fn().mockResolvedValue(true),
      sendContactConfirmation: jest.fn().mockResolvedValue(true),
    } as any;
    (EmailService as jest.MockedClass<typeof EmailService>).mockImplementation(() => mockEmailService);
  });

  describe('POST /api/contact', () => {
    it('should process contact form successfully', async () => {
      prismaMock.contact.create.mockResolvedValue({
        id: 'contact-123',
        naam: 'Jane Doe',
        email: 'jane@example.com',
        telefoon: '0687654321',
        bericht: 'Ik heb een vraag over jullie airco installatie diensten.',
        status: 'new',
        aangemaakt_op: new Date(),
      } as any);

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validContactData),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: 'Bedankt voor uw bericht. We nemen zo snel mogelijk contact met u op.',
      });

      // Verify database call
      expect(prismaMock.contact.create).toHaveBeenCalledWith({
        data: {
          naam: 'Jane Doe',
          email: 'jane@example.com',
          telefoon: '0687654321',
          bericht: 'Ik heb een vraag over jullie airco installatie diensten.',
          status: 'new',
        },
      });

      // Verify email service calls
      expect(mockEmailService.sendContactFormEmail).toHaveBeenCalledWith({
        naam: 'Jane Doe',
        email: 'jane@example.com',
        telefoon: '0687654321',
        bericht: 'Ik heb een vraag over jullie airco installatie diensten.',
      });
      expect(mockEmailService.sendContactConfirmation).toHaveBeenCalledWith(
        'jane@example.com',
        'Jane Doe'
      );
    });

    it('should validate required fields', async () => {
      const invalidContact = {
        naam: '',
        email: 'invalid-email',
        telefoon: '123',
        bericht: 'Te kort',
      };

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(invalidContact),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(data.error.details).toBeDefined();
      expect(prismaMock.contact.create).not.toHaveBeenCalled();
    });

    it('should validate email format', async () => {
      const invalidEmail = {
        ...validContactData,
        email: 'not-an-email',
      };

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(invalidEmail),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(data.error.details[0].message).toContain('email');
    });

    it('should validate phone number format', async () => {
      const invalidPhone = {
        ...validContactData,
        telefoon: 'abc123',
      };

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(invalidPhone),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(data.error.details[0].message).toContain('telefoonnummer');
    });

    it('should validate message length', async () => {
      const shortMessage = {
        ...validContactData,
        bericht: 'Te kort',
      };

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(shortMessage),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(data.error.details[0].message).toContain('minimaal 10');
    });

    it('should handle database errors', async () => {
      prismaMock.contact.create.mockRejectedValue(
        new Error('Database connection failed')
      );

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validContactData),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.code).toBe(ErrorCode.DATABASE_ERROR);
    });

    it('should handle email service failures gracefully', async () => {
      prismaMock.contact.create.mockResolvedValue({
        id: 'contact-123',
        naam: 'Jane Doe',
        email: 'jane@example.com',
        telefoon: '0687654321',
        bericht: 'Ik heb een vraag over jullie airco installatie diensten.',
        status: 'new',
        aangemaakt_op: new Date(),
      } as any);

      mockEmailService.sendContactFormEmail.mockRejectedValue(
        new Error('Email service unavailable')
      );

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validContactData),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      // Should still succeed even if email fails
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(prismaMock.contact.create).toHaveBeenCalled();
    });

    it('should sanitize input data', async () => {
      const maliciousContact = {
        naam: 'Jane<script>alert("XSS")</script>Doe',
        email: 'jane@example.com',
        telefoon: '0687654321',
        bericht: 'Question<script>evil()</script> about airco installation services.',
      };

      prismaMock.contact.create.mockResolvedValue({
        id: 'contact-123',
        naam: 'JaneDoe',
        email: 'jane@example.com',
        telefoon: '0687654321',
        bericht: 'Question about airco installation services.',
        status: 'new',
        aangemaakt_op: new Date(),
      } as any);

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(maliciousContact),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(prismaMock.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          naam: 'JaneDoe',
          bericht: 'Question about airco installation services.',
        }),
      });
    });

    it('should rate limit excessive requests', async () => {
      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '192.168.1.200',
        },
        body: JSON.stringify(validContactData),
      });

      // Simulate rate limiting by making multiple requests
      for (let i = 0; i < 11; i++) {
        await contactHandler(request);
      }

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.error.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
    });

    it('should handle missing optional fields', async () => {
      const minimalContact = {
        naam: 'Jane Doe',
        email: 'jane@example.com',
        telefoon: '0687654321',
        bericht: 'This is a test message with enough content.',
      };

      prismaMock.contact.create.mockResolvedValue({
        id: 'contact-123',
        naam: 'Jane Doe',
        email: 'jane@example.com',
        telefoon: '0687654321',
        bericht: 'This is a test message with enough content.',
        status: 'new',
        aangemaakt_op: new Date(),
      } as any);

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(minimalContact),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should detect and block SQL injection attempts', async () => {
      const sqlInjection = {
        ...validContactData,
        bericht: "'; DROP TABLE contacts; -- This is a test message",
      };

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sqlInjection),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.message).toContain('beveiligingsredenen');
    });

    it('should detect and block XSS attempts', async () => {
      const xssAttempt = {
        ...validContactData,
        bericht: '<img src=x onerror=alert("XSS")> This is a test message with malicious content.',
      };

      const request = new NextRequest('http://localhost:3000/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(xssAttempt),
      });

      const response = await contactHandler(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.message).toContain('beveiligingsredenen');
    });
  });
});