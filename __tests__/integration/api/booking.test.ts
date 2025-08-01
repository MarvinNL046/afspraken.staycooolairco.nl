/**
 * Booking API Integration Tests
 * 
 * Tests the booking API endpoint with database and service integration
 */

import { createMocks } from 'node-mocks-http';
import { NextRequest } from 'next/server';
import { POST as bookingHandler } from '@/app/api/booking/route';
import { prismaMock } from '@/jest.setup.integration';
import { JWTService } from '@/lib/services/auth/jwt.service';
import { GoogleMapsService } from '@/lib/services/google-maps-cached';
import { CacheService } from '@/lib/services/cache';
import { EmailService } from '@/lib/services/email';
import { ErrorCode } from '@/lib/errors/types';
import { addDays, format } from 'date-fns';

// Mock services
jest.mock('@/lib/services/auth/jwt.service');
jest.mock('@/lib/services/google-maps-cached');
jest.mock('@/lib/services/cache');
jest.mock('@/lib/services/email');

describe('Booking API Integration', () => {
  let mockJWTService: jest.Mocked<JWTService>;
  let mockGoogleMapsService: jest.Mocked<GoogleMapsService>;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockEmailService: jest.Mocked<EmailService>;

  const validBookingData = {
    naam: 'John Doe',
    email: 'john@example.com',
    telefoon: '0612345678',
    adres: 'Teststraat 123',
    stad: 'Amsterdam',
    postcode: '1234AB',
    datum: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
    tijd: '10:00',
    serviceType: 'onderhoud',
    vraag: 'Airco onderhoud nodig',
    token: 'valid.jwt.token',
  };

  const jwtPayload = {
    leadId: 'lead-123',
    email: 'john@example.com',
    sessionId: 'session-123',
    type: 'booking',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up JWT service mock
    mockJWTService = {
      verifyToken: jest.fn().mockResolvedValue({
        valid: true,
        payload: jwtPayload,
      }),
    } as any;
    (JWTService as jest.MockedClass<typeof JWTService>).mockImplementation(() => mockJWTService);

    // Set up Google Maps service mock
    mockGoogleMapsService = {
      geocodeAddress: jest.fn().mockResolvedValue({
        latitude: 52.3676,
        longitude: 4.9041,
        formatted_address: 'Teststraat 123, 1234 AB Amsterdam',
      }),
    } as any;
    (GoogleMapsService as jest.MockedClass<typeof GoogleMapsService>).mockImplementation(() => mockGoogleMapsService);

    // Set up cache service mock
    mockCacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(true),
    } as any;
    (CacheService as jest.MockedClass<typeof CacheService>).mockImplementation(() => mockCacheService);

    // Set up email service mock
    mockEmailService = {
      sendBookingConfirmation: jest.fn().mockResolvedValue(true),
      sendAdminNotification: jest.fn().mockResolvedValue(true),
    } as any;
    (EmailService as jest.MockedClass<typeof EmailService>).mockImplementation(() => mockEmailService);
  });

  describe('POST /api/booking', () => {
    it('should create a booking successfully', async () => {
      // Mock Prisma responses
      prismaMock.lead.findUnique.mockResolvedValue({
        id: 'lead-123',
        naam: 'John Doe',
        email: 'john@example.com',
        telefoon: '0612345678',
        status: 'new',
        bron: 'gohighlevel',
        aangemaakt_op: new Date(),
      } as any);

      prismaMock.afspraak.create.mockResolvedValue({
        id: 'afspraak-123',
        lead_id: 'lead-123',
        datum: new Date(validBookingData.datum),
        tijd: validBookingData.tijd,
        duur: 60,
        locatie: 'Teststraat 123, 1234 AB Amsterdam',
        latitude: 52.3676,
        longitude: 4.9041,
        serviceType: 'onderhoud',
        status: 'gepland',
        notities: validBookingData.vraag,
        aangemaakt_op: new Date(),
      } as any);

      prismaMock.lead.update.mockResolvedValue({
        id: 'lead-123',
        status: 'scheduled',
      } as any);

      // Create request
      const request = new NextRequest('http://localhost:3000/api/booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBookingData),
      });

      // Call handler
      const response = await bookingHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        appointment: expect.objectContaining({
          id: 'afspraak-123',
          datum: expect.any(String),
          tijd: '10:00',
          locatie: 'Teststraat 123, 1234 AB Amsterdam',
          serviceType: 'onderhoud',
        }),
      });

      // Verify service calls
      expect(mockJWTService.verifyToken).toHaveBeenCalledWith(validBookingData.token);
      expect(mockGoogleMapsService.geocodeAddress).toHaveBeenCalledWith(
        'Teststraat 123, Amsterdam 1234AB'
      );
      expect(mockEmailService.sendBookingConfirmation).toHaveBeenCalled();
      expect(mockEmailService.sendAdminNotification).toHaveBeenCalled();
    });

    it('should reject invalid JWT token', async () => {
      mockJWTService.verifyToken.mockResolvedValue({
        valid: false,
        error: 'Token expired',
      });

      const request = new NextRequest('http://localhost:3000/api/booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBookingData),
      });

      const response = await bookingHandler(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        error: {
          code: ErrorCode.AUTHENTICATION_ERROR,
          message: 'Ongeldige of verlopen sessie',
        },
      });
    });

    it('should reject if lead not found', async () => {
      prismaMock.lead.findUnique.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBookingData),
      });

      const response = await bookingHandler(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({
        error: {
          code: ErrorCode.NOT_FOUND,
          message: 'Lead niet gevonden',
        },
      });
    });

    it('should reject past dates', async () => {
      const pastBooking = {
        ...validBookingData,
        datum: '2020-01-01',
      };

      const request = new NextRequest('http://localhost:3000/api/booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pastBooking),
      });

      const response = await bookingHandler(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('should handle geocoding failures gracefully', async () => {
      mockGoogleMapsService.geocodeAddress.mockRejectedValue(
        new Error('Geocoding failed')
      );

      prismaMock.lead.findUnique.mockResolvedValue({
        id: 'lead-123',
        naam: 'John Doe',
        email: 'john@example.com',
        telefoon: '0612345678',
        status: 'new',
        bron: 'gohighlevel',
        aangemaakt_op: new Date(),
      } as any);

      prismaMock.afspraak.create.mockResolvedValue({
        id: 'afspraak-123',
        lead_id: 'lead-123',
        datum: new Date(validBookingData.datum),
        tijd: validBookingData.tijd,
        duur: 60,
        locatie: 'Teststraat 123, Amsterdam 1234AB',
        latitude: null,
        longitude: null,
        serviceType: 'onderhoud',
        status: 'gepland',
        notities: validBookingData.vraag,
        aangemaakt_op: new Date(),
      } as any);

      prismaMock.lead.update.mockResolvedValue({
        id: 'lead-123',
        status: 'scheduled',
      } as any);

      const request = new NextRequest('http://localhost:3000/api/booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBookingData),
      });

      const response = await bookingHandler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.appointment.latitude).toBeNull();
      expect(data.appointment.longitude).toBeNull();
    });

    it('should handle database errors', async () => {
      prismaMock.lead.findUnique.mockResolvedValue({
        id: 'lead-123',
        naam: 'John Doe',
        email: 'john@example.com',
        telefoon: '0612345678',
        status: 'new',
        bron: 'gohighlevel',
        aangemaakt_op: new Date(),
      } as any);

      prismaMock.afspraak.create.mockRejectedValue(
        new Error('Database connection failed')
      );

      const request = new NextRequest('http://localhost:3000/api/booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBookingData),
      });

      const response = await bookingHandler(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.code).toBe(ErrorCode.DATABASE_ERROR);
    });

    it('should validate required fields', async () => {
      const invalidBooking = {
        ...validBookingData,
        email: 'invalid-email',
        telefoon: '123',
      };

      const request = new NextRequest('http://localhost:3000/api/booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(invalidBooking),
      });

      const response = await bookingHandler(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(data.error.details).toBeDefined();
    });

    it('should prevent duplicate bookings', async () => {
      prismaMock.lead.findUnique.mockResolvedValue({
        id: 'lead-123',
        naam: 'John Doe',
        email: 'john@example.com',
        telefoon: '0612345678',
        status: 'scheduled',
        bron: 'gohighlevel',
        aangemaakt_op: new Date(),
      } as any);

      prismaMock.afspraak.findFirst.mockResolvedValue({
        id: 'existing-afspraak',
        lead_id: 'lead-123',
        status: 'gepland',
      } as any);

      const request = new NextRequest('http://localhost:3000/api/booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBookingData),
      });

      const response = await bookingHandler(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error.message).toContain('reeds een afspraak');
    });

    it('should rate limit excessive requests', async () => {
      // Mock rate limit exceeded
      const rateLimitedRequest = new NextRequest('http://localhost:3000/api/booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '192.168.1.100',
        },
        body: JSON.stringify(validBookingData),
      });

      // Simulate rate limit by making multiple requests
      for (let i = 0; i < 101; i++) {
        await bookingHandler(rateLimitedRequest);
      }

      const response = await bookingHandler(rateLimitedRequest);
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.error.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
    });
  });
});