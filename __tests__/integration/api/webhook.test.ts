/**
 * Webhook API Integration Tests
 * 
 * Tests the webhook API endpoint with database and service integration
 */

import { NextRequest } from 'next/server';
import { POST as webhookHandler } from '@/app/api/webhook/gohighlevel/route';
import { prismaMock } from '@/jest.setup.integration';
import { JWTService } from '@/lib/services/auth/jwt.service';
import { EmailService } from '@/lib/services/email';
import { ErrorCode } from '@/lib/errors/types';
import { addDays, format } from 'date-fns';

// Mock services
jest.mock('@/lib/services/auth/jwt.service');
jest.mock('@/lib/services/email');

describe('Webhook API Integration', () => {
  let mockJWTService: jest.Mocked<JWTService>;
  let mockEmailService: jest.Mocked<EmailService>;

  const validWebhookData = {
    leadId: 'ghl-lead-123',
    email: 'test@example.com',
    naam: 'Test User',
    telefoon: '0612345678',
    adres: 'Testlaan 456',
    stad: 'Rotterdam',
    postcode: '3012AB',
    datum: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
    tijd: '14:00',
    serviceType: 'storing',
    vraag: 'Airco maakt vreemd geluid',
    source: 'gohighlevel',
    metadata: {
      campaign: 'summer-2024',
      referrer: 'google-ads',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up JWT service mock
    mockJWTService = {
      generateBookingToken: jest.fn().mockResolvedValue({
        token: 'generated.jwt.token',
        expiresIn: 3600,
      }),
    } as any;
    (JWTService as jest.MockedClass<typeof JWTService>).mockImplementation(() => mockJWTService);

    // Set up email service mock
    mockEmailService = {
      sendBookingLink: jest.fn().mockResolvedValue(true),
    } as any;
    (EmailService as jest.MockedClass<typeof EmailService>).mockImplementation(() => mockEmailService);

    // Set environment variables
    process.env.GOHIGHLEVEL_WEBHOOK_SECRET = 'test-webhook-secret';
    process.env.BASE_URL = 'http://localhost:3000';
  });

  describe('POST /api/webhook/gohighlevel', () => {
    it('should process webhook and create lead successfully', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(null);
      prismaMock.lead.create.mockResolvedValue({
        id: 'lead-123',
        externe_id: 'ghl-lead-123',
        naam: 'Test User',
        email: 'test@example.com',
        telefoon: '0612345678',
        adres: 'Testlaan 456',
        stad: 'Rotterdam',
        postcode: '3012AB',
        voorkeur_datum: new Date(validWebhookData.datum),
        voorkeur_tijd: '14:00',
        service_type: 'storing',
        vraag: 'Airco maakt vreemd geluid',
        status: 'new',
        bron: 'gohighlevel',
        metadata: validWebhookData.metadata,
        aangemaakt_op: new Date(),
      } as any);

      const request = new NextRequest('http://localhost:3000/api/webhook/gohighlevel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'test-webhook-secret',
        },
        body: JSON.stringify(validWebhookData),
      });

      const response = await webhookHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        leadId: 'lead-123',
        bookingUrl: expect.stringContaining('/booking?token='),
      });

      // Verify service calls
      expect(mockJWTService.generateBookingToken).toHaveBeenCalledWith({
        leadId: 'lead-123',
        email: 'test@example.com',
        sessionId: expect.any(String),
      });
      expect(mockEmailService.sendBookingLink).toHaveBeenCalledWith(
        'test@example.com',
        'Test User',
        expect.stringContaining('/booking?token=')
      );
    });

    it('should reject webhook without secret', async () => {
      const request = new NextRequest('http://localhost:3000/api/webhook/gohighlevel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validWebhookData),
      });

      const response = await webhookHandler(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        error: {
          code: ErrorCode.AUTHENTICATION_ERROR,
          message: 'Webhook geheim ontbreekt',
        },
      });
    });

    it('should reject webhook with invalid secret', async () => {
      const request = new NextRequest('http://localhost:3000/api/webhook/gohighlevel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'wrong-secret',
        },
        body: JSON.stringify(validWebhookData),
      });

      const response = await webhookHandler(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        error: {
          code: ErrorCode.AUTHENTICATION_ERROR,
          message: 'Ongeldig webhook geheim',
        },
      });
    });

    it('should update existing lead', async () => {
      prismaMock.lead.findUnique.mockResolvedValue({
        id: 'existing-lead-123',
        externe_id: 'ghl-lead-123',
        naam: 'Old Name',
        email: 'old@example.com',
        status: 'new',
        aangemaakt_op: new Date(),
      } as any);

      prismaMock.lead.update.mockResolvedValue({
        id: 'existing-lead-123',
        externe_id: 'ghl-lead-123',
        naam: 'Test User',
        email: 'test@example.com',
        telefoon: '0612345678',
        adres: 'Testlaan 456',
        stad: 'Rotterdam',
        postcode: '3012AB',
        voorkeur_datum: new Date(validWebhookData.datum),
        voorkeur_tijd: '14:00',
        service_type: 'storing',
        vraag: 'Airco maakt vreemd geluid',
        status: 'new',
        bron: 'gohighlevel',
        metadata: validWebhookData.metadata,
        bijgewerkt_op: new Date(),
      } as any);

      const request = new NextRequest('http://localhost:3000/api/webhook/gohighlevel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'test-webhook-secret',
        },
        body: JSON.stringify(validWebhookData),
      });

      const response = await webhookHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.leadId).toBe('existing-lead-123');
      expect(prismaMock.lead.update).toHaveBeenCalledWith({
        where: { id: 'existing-lead-123' },
        data: expect.objectContaining({
          naam: 'Test User',
          email: 'test@example.com',
        }),
      });
    });

    it('should validate webhook data', async () => {
      const invalidWebhook = {
        ...validWebhookData,
        email: 'invalid-email',
        telefoon: '123',
        postcode: 'invalid',
      };

      const request = new NextRequest('http://localhost:3000/api/webhook/gohighlevel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'test-webhook-secret',
        },
        body: JSON.stringify(invalidWebhook),
      });

      const response = await webhookHandler(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(data.error.details).toBeDefined();
    });

    it('should handle missing optional fields', async () => {
      const minimalWebhook = {
        leadId: 'ghl-lead-minimal',
        email: 'minimal@example.com',
      };

      prismaMock.lead.findUnique.mockResolvedValue(null);
      prismaMock.lead.create.mockResolvedValue({
        id: 'lead-minimal',
        externe_id: 'ghl-lead-minimal',
        email: 'minimal@example.com',
        status: 'new',
        bron: 'gohighlevel',
        aangemaakt_op: new Date(),
      } as any);

      const request = new NextRequest('http://localhost:3000/api/webhook/gohighlevel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'test-webhook-secret',
        },
        body: JSON.stringify(minimalWebhook),
      });

      const response = await webhookHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle database errors', async () => {
      prismaMock.lead.findUnique.mockRejectedValue(
        new Error('Database connection failed')
      );

      const request = new NextRequest('http://localhost:3000/api/webhook/gohighlevel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'test-webhook-secret',
        },
        body: JSON.stringify(validWebhookData),
      });

      const response = await webhookHandler(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.code).toBe(ErrorCode.DATABASE_ERROR);
    });

    it('should handle email service failures gracefully', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(null);
      prismaMock.lead.create.mockResolvedValue({
        id: 'lead-123',
        externe_id: 'ghl-lead-123',
        naam: 'Test User',
        email: 'test@example.com',
        status: 'new',
        bron: 'gohighlevel',
        aangemaakt_op: new Date(),
      } as any);

      mockEmailService.sendBookingLink.mockRejectedValue(
        new Error('Email service unavailable')
      );

      const request = new NextRequest('http://localhost:3000/api/webhook/gohighlevel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'test-webhook-secret',
        },
        body: JSON.stringify(validWebhookData),
      });

      const response = await webhookHandler(request);
      const data = await response.json();

      // Should still succeed even if email fails
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.leadId).toBe('lead-123');
    });

    it('should handle JWT generation failures', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(null);
      prismaMock.lead.create.mockResolvedValue({
        id: 'lead-123',
        externe_id: 'ghl-lead-123',
        naam: 'Test User',
        email: 'test@example.com',
        status: 'new',
        bron: 'gohighlevel',
        aangemaakt_op: new Date(),
      } as any);

      mockJWTService.generateBookingToken.mockRejectedValue(
        new Error('JWT generation failed')
      );

      const request = new NextRequest('http://localhost:3000/api/webhook/gohighlevel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'test-webhook-secret',
        },
        body: JSON.stringify(validWebhookData),
      });

      const response = await webhookHandler(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it('should sanitize input data', async () => {
      const maliciousWebhook = {
        ...validWebhookData,
        naam: 'Test<script>alert("XSS")</script>User',
        vraag: 'Question<script>evil()</script>',
      };

      prismaMock.lead.findUnique.mockResolvedValue(null);
      prismaMock.lead.create.mockResolvedValue({
        id: 'lead-123',
        externe_id: 'ghl-lead-123',
        naam: 'TestUser',
        email: 'test@example.com',
        vraag: 'Question',
        status: 'new',
        bron: 'gohighlevel',
        aangemaakt_op: new Date(),
      } as any);

      const request = new NextRequest('http://localhost:3000/api/webhook/gohighlevel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'test-webhook-secret',
        },
        body: JSON.stringify(maliciousWebhook),
      });

      const response = await webhookHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(prismaMock.lead.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          naam: 'TestUser',
          vraag: 'Question',
        }),
      });
    });
  });
});