/**
 * Integration Tests for GoHighLevel Webhook Processing
 * 
 * Tests the complete webhook processing flow including:
 * - Webhook signature validation
 * - Lead data processing and normalization
 * - Service area validation
 * - Token generation and validation
 * - Database operations
 * - Error handling
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

// Mock environment variables
process.env.GOHIGHLEVEL_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.BOOKING_BASE_URL = 'https://test.staycoolairco.nl';
process.env.DATABASE_URL = 'file:./test.db';

// Test utilities
class WebhookTestUtils {
  static generateSignature(body: string, secret: string): string {
    return 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('hex');
  }

  static createTestEvent(payload: any, signature?: string) {
    const body = JSON.stringify(payload);
    return {
      httpMethod: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ghl-signature': signature || this.generateSignature(body, process.env.GOHIGHLEVEL_WEBHOOK_SECRET!),
      },
      body: body,
      queryStringParameters: null,
    };
  }

  static createValidWebhookPayload(overrides: any = {}) {
    return {
      type: 'ContactCreate',
      locationId: 'test-location-123',
      eventId: `test-event-${Date.now()}`,
      timestamp: new Date().toISOString(),
      data: {
        id: 'contact-123',
        contactId: 'contact-123',
        firstName: 'Jan',
        lastName: 'Jansen',
        email: 'jan.jansen@example.nl',
        phone: '06-12345678',
        address1: 'Hoofdstraat 123',
        city: 'Maastricht',
        postalCode: '6211 AB',
        country: 'Netherlands',
        tags: ['airco', 'installatie'],
        customFields: {
          interest: 'airconditioning',
          budget: '2000-3000'
        },
        ...overrides.data
      },
      ...overrides
    };
  }
}

describe('GoHighLevel Webhook Integration Tests', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    // Initialize test database
    await prisma.$connect();
  });

  afterAll(async () => {
    // Cleanup test database
    await prisma.webhookEvent.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up before each test
    await prisma.webhookEvent.deleteMany({});
    await prisma.lead.deleteMany({});
  });

  describe('Webhook Signature Validation', () => {
    test('should accept valid webhook signature', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload();
      const event = WebhookTestUtils.createTestEvent(payload);
      
      // Import handler dynamically to ensure env vars are set
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.leadId).toBeDefined();
      expect(body.bookingToken).toBeDefined();
    });

    test('should reject invalid webhook signature', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload();
      const event = WebhookTestUtils.createTestEvent(payload, 'sha256=invalid-signature');
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid webhook signature');
    });

    test('should reject missing webhook signature', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload();
      const event = {
        ...WebhookTestUtils.createTestEvent(payload),
        headers: { 'content-type': 'application/json' } // No signature header
      };
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Missing webhook signature');
    });
  });

  describe('Lead Data Processing', () => {
    test('should process valid lead data correctly', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload();
      const event = WebhookTestUtils.createTestEvent(payload);
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      
      expect(body.lead.name).toBe('Jan Jansen');
      expect(body.lead.email).toBe('jan.jansen@example.nl');
      expect(body.lead.phone).toBe('+31612345678'); // Formatted phone
      expect(body.serviceArea.isEligible).toBe(true); // Maastricht is in Limburg
      expect(body.serviceArea.region).toBe('Limburg');
    });

    test('should handle missing optional fields gracefully', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload({
        data: {
          id: 'contact-456',
          firstName: 'Marie',
          email: 'marie@example.nl'
          // Missing lastName, phone, address
        }
      });
      const event = WebhookTestUtils.createTestEvent(payload);
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      
      expect(body.lead.name).toBe('Marie');
      expect(body.lead.email).toBe('marie@example.nl');
      expect(body.lead.phone).toBeNull();
      expect(body.lead.address).toBeNull();
    });

    test('should identify leads outside service area', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload({
        data: {
          city: 'Amsterdam',
          postalCode: '1012 AB' // Amsterdam postal code
        }
      });
      const event = WebhookTestUtils.createTestEvent(payload);
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      
      expect(body.serviceArea.isEligible).toBe(false);
      expect(body.serviceArea.region).not.toBe('Limburg');
    });
  });

  describe('Database Operations', () => {
    test('should create new lead in database', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload();
      const event = WebhookTestUtils.createTestEvent(payload);
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      
      // Verify lead was created in database
      const lead = await prisma.lead.findUnique({
        where: { id: body.leadId }
      });
      
      expect(lead).toBeDefined();
      expect(lead?.naam).toBe('Jan Jansen');
      expect(lead?.email).toBe('jan.jansen@example.nl');
      expect(lead?.bronSysteem).toBe('gohighlevel');
    });

    test('should update existing lead', async () => {
      // First create a lead
      const leadData = {
        id: 'existing-lead-123',
        naam: 'Jan Jansen Old',
        email: 'jan.jansen@example.nl',
        bronSysteem: 'gohighlevel',
        bronId: 'contact-123',
        isInServiceArea: true,
        status: 'nieuw',
        createdAt: new Date(),
        lastContactAt: new Date(),
      };
      
      await prisma.lead.create({ data: leadData });
      
      // Send webhook with updated data
      const payload = WebhookTestUtils.createValidWebhookPayload({
        data: {
          firstName: 'Jan',
          lastName: 'Jansen Updated',
          phone: '06-87654321'
        }
      });
      const event = WebhookTestUtils.createTestEvent(payload);
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(201);
      
      // Verify lead was updated
      const updatedLead = await prisma.lead.findUnique({
        where: { email: 'jan.jansen@example.nl' }
      });
      
      expect(updatedLead?.naam).toBe('Jan Jansen Updated');
      expect(updatedLead?.telefoon).toBe('+31687654321');
    });

    test('should log webhook event', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload();
      const event = WebhookTestUtils.createTestEvent(payload);
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      await handler(event, {} as any);
      
      // Verify webhook event was logged
      const webhookEvent = await prisma.webhookEvent.findUnique({
        where: { eventId: payload.eventId }
      });
      
      expect(webhookEvent).toBeDefined();
      expect(webhookEvent?.eventType).toBe('ContactCreate');
      expect(webhookEvent?.isProcessed).toBe(true);
      expect(webhookEvent?.source).toBe('gohighlevel');
    });
  });

  describe('Token Generation and Validation', () => {
    test('should generate valid JWT token', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload();
      const event = WebhookTestUtils.createTestEvent(payload);
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      
      expect(body.bookingToken).toBeDefined();
      expect(body.bookingUrl).toContain('token=');
      expect(body.expiresAt).toBeDefined();
      
      // Token should have 3 parts (header.payload.signature)
      const tokenParts = body.bookingToken.split('.');
      expect(tokenParts).toHaveLength(3);
    });

    test('should validate generated token', async () => {
      // First generate a token
      const payload = WebhookTestUtils.createValidWebhookPayload();
      const event = WebhookTestUtils.createTestEvent(payload);
      
      const { handler: webhookHandler } = await import('../netlify/functions/gohighlevel-webhook');
      const webhookResponse = await webhookHandler(event, {} as any);
      const webhookBody = JSON.parse(webhookResponse.body);
      
      // Then validate the token
      const tokenEvent = {
        httpMethod: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: webhookBody.bookingToken }),
        queryStringParameters: null,
      };
      
      const { handler: tokenHandler } = await import('../netlify/functions/validate-booking-token');
      const tokenResponse = await tokenHandler(tokenEvent, {} as any);
      
      expect(tokenResponse.statusCode).toBe(200);
      const tokenBody = JSON.parse(tokenResponse.body);
      
      expect(tokenBody.valid).toBe(true);
      expect(tokenBody.lead.id).toBe(webhookBody.leadId);
      expect(tokenBody.lead.email).toBe('jan.jansen@example.nl');
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON gracefully', async () => {
      const event = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ghl-signature': 'sha256=invalid',
        },
        body: 'invalid json{',
        queryStringParameters: null,
      };
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid JSON in request body');
    });

    test('should handle missing required fields', async () => {
      const payload = {
        type: 'ContactCreate',
        // Missing required fields
      };
      const event = WebhookTestUtils.createTestEvent(payload);
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid webhook data');
    });

    test('should handle duplicate events (idempotency)', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload();
      const event = WebhookTestUtils.createTestEvent(payload);
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      
      // Process the same event twice
      const response1 = await handler(event, {} as any);
      const response2 = await handler(event, {} as any);
      
      expect(response1.statusCode).toBe(201);
      expect(response2.statusCode).toBe(200);
      
      const body2 = JSON.parse(response2.body);
      expect(body2.duplicate).toBe(true);
      expect(body2.message).toContain('Duplicate event');
    });
  });

  describe('Security Tests', () => {
    test('should reject requests without proper method', async () => {
      const payload = WebhookTestUtils.createValidWebhookPayload();
      const event = {
        ...WebhookTestUtils.createTestEvent(payload),
        httpMethod: 'GET'
      };
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(405);
    });

    test('should handle CORS preflight', async () => {
      const event = {
        httpMethod: 'OPTIONS',
        headers: {},
        body: null,
        queryStringParameters: null,
      };
      
      const { handler } = await import('../netlify/functions/gohighlevel-webhook');
      const response = await handler(event, {} as any);
      
      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Access-Control-Allow-Origin']).toBe('*');
    });
  });
});

describe('Token Validation Tests', () => {
  test('should reject expired tokens', async () => {
    // Create a token with past expiration
    const expiredPayload = {
      leadId: 'test-lead',
      email: 'test@example.nl',
      expiresAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
    };
    
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', process.env.JWT_SECRET!)
      .update(`${header}.${payload}`)
      .digest('base64url');
    
    const expiredToken = `${header}.${payload}.${signature}`;
    
    const event = {
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: expiredToken }),
      queryStringParameters: null,
    };
    
    const { handler } = await import('../netlify/functions/validate-booking-token');
    const response = await handler(event, {} as any);
    
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Token expired');
  });

  test('should reject tokens with invalid signature', async () => {
    const validPayload = {
      leadId: 'test-lead',
      email: 'test@example.nl',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(validPayload)).toString('base64url');
    const invalidSignature = 'invalid-signature';
    
    const invalidToken = `${header}.${payload}.${invalidSignature}`;
    
    const event = {
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: invalidToken }),
      queryStringParameters: null,
    };
    
    const { handler } = await import('../netlify/functions/validate-booking-token');
    const response = await handler(event, {} as any);
    
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Invalid or expired token');
  });
});