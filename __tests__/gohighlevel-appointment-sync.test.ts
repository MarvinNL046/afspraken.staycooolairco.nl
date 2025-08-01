import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { handler as syncHandler } from '../netlify/functions/gohighlevel-appointment-sync';
import { handler as monitorHandler } from '../netlify/functions/gohighlevel-sync-monitor';
import { GoHighLevelAPIClient, GHLAPIError, GHLRateLimitError } from '../lib/services/gohighlevel/ghl-api-client';
import { GoHighLevelSyncService } from '../lib/services/gohighlevel/appointment-sync.service';
import { PrismaClient } from '@prisma/client';
import type { HandlerEvent, HandlerContext } from '@netlify/functions';

// Mock Prisma
jest.mock('@prisma/client');
const mockPrisma = {
  afspraak: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  lead: {
    findUnique: jest.fn(),
  },
  customer: {
    findUnique: jest.fn(),
  },
  timeSlot: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $disconnect: jest.fn(),
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};

(PrismaClient as jest.Mock).mockImplementation(() => mockPrisma);

// Mock GoHighLevel API Client
jest.mock('../lib/services/gohighlevel/ghl-api-client');

describe('GoHighLevel Appointment Sync', () => {
  let mockGHLClient: jest.Mocked<GoHighLevelAPIClient>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock GHL client
    mockGHLClient = {
      getContact: jest.fn(),
      updateContact: jest.fn(),
      addContactNote: jest.fn(),
      createTask: jest.fn(),
      updateOpportunity: jest.fn(),
      createAppointmentConfirmation: jest.fn(),
      updateContactAppointmentStatus: jest.fn(),
      batchUpdateContacts: jest.fn(),
    } as any;
    
    (GoHighLevelAPIClient as jest.Mock).mockImplementation(() => mockGHLClient);
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
  });
  
  describe('Sync Handler', () => {
    const createEvent = (body: any, method = 'POST'): HandlerEvent => ({
      httpMethod: method,
      headers: {},
      body: JSON.stringify(body),
      queryStringParameters: null,
      pathParameters: null,
      isBase64Encoded: false,
    } as HandlerEvent);
    
    const mockContext: HandlerContext = {} as HandlerContext;
    
    it('should handle appointment creation sync', async () => {
      const appointmentId = 'test-appointment-id';
      const ghlContactId = 'ghl-contact-123';
      
      // Mock appointment with lead
      mockPrisma.afspraak.findUnique.mockResolvedValue({
        id: appointmentId,
        datum: new Date('2024-01-20'),
        tijd: '10:00',
        duur: 120,
        locatie: 'Test Address 123',
        serviceType: 'installation',
        status: 'gepland',
        lead: {
          id: 'lead-123',
          ghlContactId: ghlContactId,
          email: 'test@example.com',
        },
        customer: {
          firstName: 'Test',
          lastName: 'User',
          email: 'test@example.com',
        },
      });
      
      // Mock GHL API responses
      mockGHLClient.addContactNote.mockResolvedValue({ success: true });
      mockGHLClient.updateContactAppointmentStatus.mockResolvedValue({ success: true });
      mockGHLClient.createTask.mockResolvedValue({ success: true });
      
      const response = await syncHandler(
        createEvent({
          appointmentId,
          action: 'create',
        }),
        mockContext
      );
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body || '{}');
      expect(body.success).toBe(true);
      expect(body.appointmentId).toBe(appointmentId);
      expect(body.action).toBe('create');
      expect(body.ghlContactId).toBe(ghlContactId);
      
      // Verify GHL API calls
      expect(mockGHLClient.addContactNote).toHaveBeenCalledWith(
        expect.objectContaining({
          contactId: ghlContactId,
          body: expect.stringContaining('Nieuwe Afspraak Ingepland'),
        })
      );
      
      expect(mockGHLClient.updateContactAppointmentStatus).toHaveBeenCalledWith(
        ghlContactId,
        'scheduled',
        expect.any(String)
      );
      
      expect(mockGHLClient.createTask).toHaveBeenCalled();
    });
    
    it('should handle appointment confirmation sync', async () => {
      const appointmentId = 'test-appointment-id';
      const ghlContactId = 'ghl-contact-123';
      
      mockPrisma.afspraak.findUnique.mockResolvedValue({
        id: appointmentId,
        datum: new Date('2024-01-20'),
        tijd: '10:00',
        locatie: 'Test Address 123',
        serviceType: 'maintenance',
        status: 'bevestigd',
        lead: {
          id: 'lead-123',
          ghlContactId: ghlContactId,
        },
      });
      
      mockGHLClient.createAppointmentConfirmation.mockResolvedValue({ success: true });
      mockGHLClient.updateContactAppointmentStatus.mockResolvedValue({ success: true });
      
      const response = await syncHandler(
        createEvent({
          appointmentId,
          action: 'confirm',
        }),
        mockContext
      );
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body || '{}');
      expect(body.success).toBe(true);
      
      expect(mockGHLClient.createAppointmentConfirmation).toHaveBeenCalledWith(
        ghlContactId,
        expect.objectContaining({
          appointmentId,
          serviceType: expect.any(String),
        })
      );
      
      expect(mockGHLClient.updateContactAppointmentStatus).toHaveBeenCalledWith(
        ghlContactId,
        'confirmed',
        expect.any(String)
      );
    });
    
    it('should handle rate limiting errors with retry', async () => {
      const appointmentId = 'test-appointment-id';
      
      mockPrisma.afspraak.findUnique.mockResolvedValue({
        id: appointmentId,
        lead: {
          ghlContactId: 'ghl-contact-123',
        },
      });
      
      // Mock rate limit error
      mockGHLClient.addContactNote.mockRejectedValue(new GHLRateLimitError(5));
      
      const response = await syncHandler(
        createEvent({
          appointmentId,
          action: 'create',
        }),
        mockContext
      );
      
      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body || '{}');
      expect(body.retryable).toBe(true);
      expect(body.retryAfter).toBeDefined();
    });
    
    it('should handle missing GHL contact ID', async () => {
      const appointmentId = 'test-appointment-id';
      
      mockPrisma.afspraak.findUnique.mockResolvedValue({
        id: appointmentId,
        lead: {
          id: 'lead-123',
          ghlContactId: null, // No GHL contact ID
        },
      });
      
      const response = await syncHandler(
        createEvent({
          appointmentId,
          action: 'create',
        }),
        mockContext
      );
      
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body || '{}');
      expect(body.error).toContain('No GoHighLevel contact');
    });
    
    it('should handle idempotent requests', async () => {
      const appointmentId = 'test-appointment-id';
      const ghlContactId = 'ghl-contact-123';
      
      mockPrisma.afspraak.findUnique.mockResolvedValue({
        id: appointmentId,
        lead: {
          ghlContactId: ghlContactId,
        },
      });
      
      mockGHLClient.addContactNote.mockResolvedValue({ success: true });
      mockGHLClient.updateContactAppointmentStatus.mockResolvedValue({ success: true });
      
      // First request
      await syncHandler(
        createEvent({
          appointmentId,
          action: 'create',
          timestamp: '2024-01-15T10:00:00Z',
        }),
        mockContext
      );
      
      // Clear mocks
      mockGHLClient.addContactNote.mockClear();
      mockGHLClient.updateContactAppointmentStatus.mockClear();
      
      // Second identical request
      const response = await syncHandler(
        createEvent({
          appointmentId,
          action: 'create',
          timestamp: '2024-01-15T10:00:00Z',
        }),
        mockContext
      );
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body || '{}');
      expect(body.cached).toBe(true);
      
      // Should not make additional API calls
      expect(mockGHLClient.addContactNote).not.toHaveBeenCalled();
      expect(mockGHLClient.updateContactAppointmentStatus).not.toHaveBeenCalled();
    });
  });
  
  describe('Monitor Handler', () => {
    const createEvent = (queryParams: any = {}): HandlerEvent => ({
      httpMethod: 'GET',
      headers: {},
      body: null,
      queryStringParameters: queryParams,
      pathParameters: null,
      isBase64Encoded: false,
    } as HandlerEvent);
    
    const mockContext: HandlerContext = {} as HandlerContext;
    
    it('should return sync status', async () => {
      const response = await monitorHandler(
        createEvent({ action: 'status' }),
        mockContext
      );
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body || '{}');
      expect(body.success).toBe(true);
      expect(body.action).toBe('status');
      expect(body.data).toHaveProperty('totalSyncs');
      expect(body.data).toHaveProperty('successRate');
      expect(body.data).toHaveProperty('systemHealth');
    });
    
    it('should return health check', async () => {
      const response = await monitorHandler(
        createEvent({ action: 'health' }),
        mockContext
      );
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body || '{}');
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('status');
      expect(body.data).toHaveProperty('checks');
      expect(body.data).toHaveProperty('recommendations');
    });
    
    it('should handle retry action', async () => {
      const response = await monitorHandler(
        createEvent({ action: 'retry' }),
        mockContext
      );
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body || '{}');
      expect(body.success).toBe(true);
      expect(body.action).toBe('retry');
      expect(body.data).toHaveProperty('attempted');
      expect(body.data).toHaveProperty('successful');
      expect(body.data).toHaveProperty('failed');
    });
  });
  
  describe('Sync Service', () => {
    let syncService: GoHighLevelSyncService;
    
    beforeEach(() => {
      syncService = new GoHighLevelSyncService({ baseUrl: 'http://localhost:8888' });
      
      // Mock fetch
      global.fetch = jest.fn();
    });
    
    it('should sync appointment creation', async () => {
      const appointmentId = 'test-appointment-id';
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          appointmentId,
          action: 'create',
          ghlContactId: 'ghl-123',
          timestamp: new Date().toISOString(),
        }),
      });
      
      const result = await syncService.syncAppointmentCreation(appointmentId);
      
      expect(result.success).toBe(true);
      expect(result.appointmentId).toBe(appointmentId);
      expect(result.action).toBe('create');
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('gohighlevel-appointment-sync'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            appointmentId,
            action: 'create',
            timestamp: expect.any(String),
          }),
        })
      );
    });
    
    it('should handle sync errors', async () => {
      const appointmentId = 'test-appointment-id';
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          message: 'Sync failed',
          error: 'Internal server error',
        }),
      });
      
      await expect(syncService.syncAppointmentCreation(appointmentId))
        .rejects.toThrow('Sync failed');
    });
    
    it('should batch sync multiple appointments', async () => {
      const requests = [
        { appointmentId: 'apt-1', action: 'create' as const, timestamp: '2024-01-15T10:00:00Z' },
        { appointmentId: 'apt-2', action: 'confirm' as const, timestamp: '2024-01-15T10:00:00Z' },
      ];
      
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            appointmentId: 'apt-1',
            action: 'create',
            timestamp: new Date().toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({
            message: 'Sync failed',
          }),
        });
      
      const results = await syncService.batchSyncAppointments(requests);
      
      expect(results).toHaveLength(2);
      expect(results[0].result).toHaveProperty('success', true);
      expect(results[1].result).toBeInstanceOf(Error);
    });
  });
});