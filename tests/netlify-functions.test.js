const { handler: advancedAvailability } = require('../netlify/functions/advanced-availability');
const { handler: advancedBooking } = require('../netlify/functions/advanced-booking');
const { handler: advancedClusterAnalysis } = require('../netlify/functions/advanced-cluster-analysis');
const { PrismaClient } = require('@prisma/client');

// Mock Prisma client
jest.mock('@prisma/client');

// Mock Google services
jest.mock('../lib/google-maps', () => ({
  geocodeAddress: jest.fn(),
  googleMaps: {
    optimizeRoute: jest.fn(),
  },
}));

jest.mock('../lib/google-calendar', () => ({
  createGoogleCalendarEvent: jest.fn(),
}));

jest.mock('../lib/boundary-validator', () => ({
  validateServiceArea: jest.fn(),
}));

jest.mock('../lib/route-optimization', () => ({
  findAvailableSlots: jest.fn(),
}));

describe('Netlify Functions Integration Tests', () => {
  let mockPrisma;
  let mockGoogleMaps;
  let mockBoundaryValidator;
  let mockRouteOptimization;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup Prisma mock
    mockPrisma = {
      afspraak: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        upsert: jest.fn(),
      },
      blockedDate: {
        findFirst: jest.fn(),
      },
      serviceArea: {
        findFirst: jest.fn(),
      },
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
    };
    
    PrismaClient.mockImplementation(() => mockPrisma);
    
    // Setup other service mocks
    mockGoogleMaps = require('../lib/google-maps');
    mockBoundaryValidator = require('../lib/boundary-validator');
    mockRouteOptimization = require('../lib/route-optimization');
  });

  describe('Advanced Availability Function', () => {
    const createValidEvent = (method = 'POST', body = null, query = null) => ({
      httpMethod: method,
      body: body ? JSON.stringify(body) : null,
      queryStringParameters: query,
      headers: {},
      path: '/.netlify/functions/advanced-availability',
    });

    test('should handle CORS preflight request', async () => {
      const event = createValidEvent('OPTIONS');
      const response = await advancedAvailability(event);
      
      expect(response.statusCode).toBe(200);
      expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
    });

    test('should reject invalid HTTP methods', async () => {
      const event = createValidEvent('DELETE');
      const response = await advancedAvailability(event);
      
      expect(response.statusCode).toBe(405);
      expect(JSON.parse(response.body).error).toBe('Method not allowed');
    });

    test('should validate request data with Zod', async () => {
      const event = createValidEvent('POST', {
        date: 'invalid-date',
      });
      
      const response = await advancedAvailability(event);
      
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Validation error');
    });

    test('should return availability for valid request', async () => {
      // Mock successful validation
      mockBoundaryValidator.validateServiceArea.mockResolvedValue({
        isValid: true,
        isInServiceArea: true,
        message: 'Address in Limburg',
      });

      // Mock database responses
      mockPrisma.afspraak.findMany.mockResolvedValue([]);
      mockPrisma.blockedDate.findFirst.mockResolvedValue(null);
      
      // Mock route optimization
      mockRouteOptimization.findAvailableSlots.mockResolvedValue([
        {
          startTime: '10:00',
          endTime: '11:00',
          efficiency: 95,
          routeInfo: {},
        },
      ]);

      const event = createValidEvent('POST', {
        date: '2024-01-15',
        customerLocation: {
          lat: 50.8514,
          lng: 5.6909,
          address: 'Hoofdstraat 123',
          postalCode: '6221 AB',
          city: 'Maastricht',
        },
        serviceType: 'installation',
      });

      const response = await advancedAvailability(event);
      
      expect(response.statusCode).toBe(200);
      
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.availableSlots).toHaveLength(1);
      expect(data.availableSlots[0].startTime).toBe('10:00');
    });

    test('should handle service area validation failure', async () => {
      mockBoundaryValidator.validateServiceArea.mockResolvedValue({
        isValid: false,
        isInServiceArea: false,
        message: 'Address outside service area',
      });

      const event = createValidEvent('POST', {
        date: '2024-01-15',
        customerLocation: {
          lat: 52.0907, // Amsterdam coordinates (outside Limburg)
          lng: 5.1214,
          address: 'Dam 1',
          postalCode: '1012 JS',
          city: 'Amsterdam',
        },
      });

      const response = await advancedAvailability(event);
      
      expect(response.statusCode).toBe(200);
      
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.availableSlots).toHaveLength(0);
      expect(data.message).toContain('outside service area');
    });

    test('should handle weekend dates', async () => {
      const event = createValidEvent('POST', {
        date: '2024-01-13', // Saturday
      });

      const response = await advancedAvailability(event);
      
      expect(response.statusCode).toBe(200);
      
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.availableSlots).toHaveLength(0);
      expect(data.message).toContain('weekend');
    });

    test('should handle blocked dates', async () => {
      mockPrisma.blockedDate.findFirst.mockResolvedValue({
        id: '1',
        date: new Date('2024-01-15'),
        reason: 'Company holiday',
        isActive: true,
      });

      const event = createValidEvent('POST', {
        date: '2024-01-15',
      });

      const response = await advancedAvailability(event);
      
      expect(response.statusCode).toBe(200);
      
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.availableSlots).toHaveLength(0);
      expect(data.message).toContain('blocked');
    });

    test('should handle fully booked days', async () => {
      // Mock 5 existing appointments (max per day)
      mockPrisma.afspraak.findMany.mockResolvedValue([
        { id: '1', tijd: '09:30' },
        { id: '2', tijd: '10:30' },
        { id: '3', tijd: '11:30' },
        { id: '4', tijd: '13:30' },
        { id: '5', tijd: '14:30' },
      ]);
      mockPrisma.blockedDate.findFirst.mockResolvedValue(null);

      const event = createValidEvent('POST', {
        date: '2024-01-15',
      });

      const response = await advancedAvailability(event);
      
      expect(response.statusCode).toBe(200);
      
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.availableSlots).toHaveLength(0);
      expect(data.message).toContain('fully booked');
    });
  });

  describe('Advanced Booking Function', () => {
    const createValidBookingEvent = (body) => ({
      httpMethod: 'POST',
      body: JSON.stringify(body),
      headers: {},
      path: '/.netlify/functions/advanced-booking',
    });

    const validBookingData = {
      serviceType: 'installation',
      description: 'New airco installation',
      scheduledDate: '2024-01-15',
      scheduledTime: '10:00',
      customer: {
        customerType: 'residential',
        firstName: 'Jan',
        lastName: 'Jansen',
        email: 'jan@example.nl',
        phone: '06-12345678',
        address: 'Hoofdstraat',
        houseNumber: '123',
        postalCode: '6221 AB',
        city: 'Maastricht',
      },
    };

    test('should validate booking data comprehensively', async () => {
      const invalidData = {
        ...validBookingData,
        customer: {
          ...validBookingData.customer,
          email: 'invalid-email', // Invalid email
          phone: '123', // Invalid phone
        },
      };

      const event = createValidBookingEvent(invalidData);
      const response = await advancedBooking(event);
      
      expect(response.statusCode).toBe(400);
      
      const data = JSON.parse(response.body);
      expect(data.error).toBe('Validation error');
      expect(data.details).toBeInstanceOf(Array);
      expect(data.details.length).toBeGreaterThan(0);
    });

    test('should reject appointments outside business hours', async () => {
      const earlyBooking = {
        ...validBookingData,
        scheduledTime: '08:00', // Before 09:30
      };

      const event = createValidBookingEvent(earlyBooking);
      const response = await advancedBooking(event);
      
      expect(response.statusCode).toBe(400);
      
      const data = JSON.parse(response.body);
      expect(data.error).toBe('Appointment time outside business hours');
    });

    test('should reject weekend appointments', async () => {
      const weekendBooking = {
        ...validBookingData,
        scheduledDate: '2024-01-13', // Saturday
      };

      const event = createValidBookingEvent(weekendBooking);
      const response = await advancedBooking(event);
      
      expect(response.statusCode).toBe(400);
      
      const data = JSON.parse(response.body);
      expect(data.error).toBe('Appointment on non-business day');
    });

    test('should create successful booking with all validations', async () => {
      // Mock successful service area validation
      mockBoundaryValidator.validateServiceArea.mockResolvedValue({
        isValid: true,
        isInServiceArea: true,
        message: 'Address in Limburg',
      });

      // Mock geocoding
      mockGoogleMaps.geocodeAddress.mockResolvedValue({
        success: true,
        coordinates: { lat: 50.8514, lng: 5.6909 },
      });

      // Mock database transaction
      const mockCustomer = {
        id: 'customer-1',
        firstName: 'Jan',
        lastName: 'Jansen',
        email: 'jan@example.nl',
      };

      const mockAppointment = {
        id: 'appointment-1',
        serviceType: 'installation',
        datum: new Date('2024-01-15'),
        tijd: '10:00',
        status: 'gepland',
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback({
          afspraak: {
            findMany: jest.fn().mockResolvedValue([]), // No conflicts
            create: jest.fn().mockResolvedValue(mockAppointment),
          },
          customer: {
            upsert: jest.fn().mockResolvedValue(mockCustomer),
          },
          blockedDate: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        });
      });

      // Mock calendar event creation
      const mockCalendarEvent = require('../lib/google-calendar');
      mockCalendarEvent.createGoogleCalendarEvent.mockResolvedValue({
        id: 'calendar-event-1',
      });

      const event = createValidBookingEvent(validBookingData);
      const response = await advancedBooking(event);
      
      expect(response.statusCode).toBe(201);
      
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.bookingId).toBeDefined();
      expect(data.appointment.id).toBe('appointment-1');
      expect(data.customer.name).toBe('Jan Jansen');
    });

    test('should handle daily appointment limit', async () => {
      mockBoundaryValidator.validateServiceArea.mockResolvedValue({
        isValid: true,
        isInServiceArea: true,
      });

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          afspraak: {
            findMany: jest.fn().mockResolvedValue([
              { id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }
            ]), // 5 appointments = daily limit reached
          },
          blockedDate: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        };
        
        throw new Error('DAILY_LIMIT_EXCEEDED:5');
      });

      const event = createValidBookingEvent(validBookingData);
      const response = await advancedBooking(event);
      
      expect(response.statusCode).toBe(409);
      
      const data = JSON.parse(response.body);
      expect(data.error).toBe('Daily appointment limit reached');
    });

    test('should handle time conflicts', async () => {
      mockBoundaryValidator.validateServiceArea.mockResolvedValue({
        isValid: true,
        isInServiceArea: true,
      });

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        throw new Error('TIME_CONFLICT:10:00');
      });

      const event = createValidBookingEvent(validBookingData);
      const response = await advancedBooking(event);
      
      expect(response.statusCode).toBe(409);
      
      const data = JSON.parse(response.body);
      expect(data.error).toBe('Time slot already booked');
    });
  });

  describe('Advanced Cluster Analysis Function', () => {
    const createAnalysisEvent = (body) => ({
      httpMethod: 'POST',
      body: JSON.stringify(body),
      headers: {},
      path: '/.netlify/functions/advanced-cluster-analysis',
    });

    const validAnalysisData = {
      startDate: '2024-01-15',
      endDate: '2024-01-19',
      analysisType: 'efficiency',
      apiKey: 'test-admin-key',
    };

    beforeEach(() => {
      process.env.ADMIN_API_KEY = 'test-admin-key';
    });

    test('should require admin API key', async () => {
      const event = createAnalysisEvent({
        ...validAnalysisData,
        apiKey: 'wrong-key',
      });

      const response = await advancedClusterAnalysis(event);
      
      expect(response.statusCode).toBe(401);
      
      const data = JSON.parse(response.body);
      expect(data.error).toBe('Invalid API key');
    });

    test('should validate date range', async () => {
      const event = createAnalysisEvent({
        ...validAnalysisData,
        startDate: '2024-01-19',
        endDate: '2024-01-15', // End before start
      });

      const response = await advancedClusterAnalysis(event);
      
      expect(response.statusCode).toBe(400);
      
      const data = JSON.parse(response.body);
      expect(data.error).toBe('End date must be after start date');
    });

    test('should handle no appointments gracefully', async () => {
      mockPrisma.afspraak.findMany.mockResolvedValue([]);

      const event = createAnalysisEvent(validAnalysisData);
      const response = await advancedClusterAnalysis(event);
      
      expect(response.statusCode).toBe(200);
      
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.message).toContain('No appointments found');
    });

    test('should perform comprehensive cluster analysis', async () => {
      // Mock appointments with location data
      const mockAppointments = [
        {
          id: 'apt-1',
          datum: new Date('2024-01-15'),
          tijd: '10:00',
          duur: 60,
          serviceType: 'installation',
          status: 'gepland',
          colorId: '5',
          prioriteit: 5,
          customer: {
            firstName: 'Jan',
            lastName: 'Jansen',
            phone: '06-12345678',
            email: 'jan@example.nl',
            address: 'Hoofdstraat 123',
            latitude: 50.8514,
            longitude: 5.6909,
          },
          lead: null,
        },
        {
          id: 'apt-2',
          datum: new Date('2024-01-15'),
          tijd: '14:00',
          duur: 60,
          serviceType: 'maintenance',
          status: 'gepland',
          colorId: '5',
          prioriteit: 3,
          customer: null,
          lead: {
            naam: 'Piet Pietersen',
            telefoon: '06-87654321',
            email: 'piet@example.nl',
            adres: 'Kerkstraat 456',
            latitude: 50.8600,
            longitude: 5.7000,
          },
        },
      ];

      mockPrisma.afspraak.findMany.mockResolvedValue(mockAppointments);

      // Mock Google Maps optimization
      mockGoogleMaps.googleMaps.optimizeRoute.mockResolvedValue({
        routes: [{
          legs: [
            { distance: { value: 5000 }, duration: { value: 600 } },
            { distance: { value: 3000 }, duration: { value: 360 } },
          ],
        }],
        optimizedOrder: [0, 1],
      });

      const event = createAnalysisEvent(validAnalysisData);
      const response = await advancedClusterAnalysis(event);
      
      expect(response.statusCode).toBe(200);
      
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.analysis.clusters).toBeInstanceOf(Array);
      expect(data.analysis.metrics).toBeDefined();
      expect(data.analysis.recommendations).toBeInstanceOf(Array);
    });

    test('should calculate efficiency metrics correctly', async () => {
      const mockAppointments = [
        {
          id: 'apt-1',
          datum: new Date('2024-01-15'),
          tijd: '10:00',
          duur: 60,
          serviceType: 'installation',
          status: 'gepland',
          colorId: '5',
          customer: {
            firstName: 'Jan',
            lastName: 'Jansen',
            latitude: 50.8514,
            longitude: 5.6909,
            address: 'Test Address',
            phone: '06-12345678',
            email: 'jan@example.nl',
          },
          lead: null,
        },
      ];

      mockPrisma.afspraak.findMany.mockResolvedValue(mockAppointments);

      const event = createAnalysisEvent(validAnalysisData);
      const response = await advancedClusterAnalysis(event);
      
      expect(response.statusCode).toBe(200);
      
      const data = JSON.parse(response.body);
      expect(data.analysis.metrics.totalAppointments).toBe(1);
      expect(data.analysis.metrics.averageEfficiency).toBeGreaterThanOrEqual(0);
      expect(data.analysis.metrics.totalDistance).toBeGreaterThanOrEqual(0);
    });

    test('should provide optimization suggestions', async () => {
      const mockAppointments = [
        {
          id: 'apt-1',
          datum: new Date('2024-01-15'),
          tijd: '10:00',
          duur: 60,
          serviceType: 'installation',
          colorId: '5',
          customer: {
            firstName: 'Jan',
            lastName: 'Jansen',
            latitude: 50.8514,
            longitude: 5.6909,
            address: 'Test Address',
            phone: '06-12345678',
            email: 'jan@example.nl',
          },
          lead: null,
        },
      ];

      mockPrisma.afspraak.findMany.mockResolvedValue(mockAppointments);

      const event = createAnalysisEvent({
        ...validAnalysisData,
        analysisType: 'optimization',
      });

      const response = await advancedClusterAnalysis(event);
      
      expect(response.statusCode).toBe(200);
      
      const data = JSON.parse(response.body);
      expect(data.analysis.optimization).toBeDefined();
      expect(data.analysis.optimization.routeImprovements).toBeInstanceOf(Array);
      expect(data.analysis.optimization.capacityOptimizations).toBeInstanceOf(Array);
    });

    test('should handle forecasting analysis', async () => {
      mockPrisma.afspraak.findMany.mockResolvedValue([]);

      const event = createAnalysisEvent({
        ...validAnalysisData,
        analysisType: 'forecasting',
      });

      const response = await advancedClusterAnalysis(event);
      
      expect(response.statusCode).toBe(200);
      
      const data = JSON.parse(response.body);
      if (data.analysis.forecast) {
        expect(data.analysis.forecast.nextWeekPrediction).toBeDefined();
        expect(data.analysis.forecast.monthlyTrends).toBeDefined();
      }
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle database connection failures', async () => {
      mockPrisma.$connect.mockRejectedValue(new Error('Database connection failed'));

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ date: '2024-01-15' }),
        headers: {},
      };

      const response = await advancedAvailability(event);
      
      expect(response.statusCode).toBe(500);
      
      const data = JSON.parse(response.body);
      expect(data.error).toBe('Internal server error');
    });

    test('should handle malformed JSON requests', async () => {
      const event = {
        httpMethod: 'POST',
        body: 'invalid json{',
        headers: {},
      };

      const response = await advancedBooking(event);
      
      expect(response.statusCode).toBe(400);
      
      const data = JSON.parse(response.body);
      expect(data.error).toBe('Invalid JSON in request body');
    });

    test('should handle missing request body', async () => {
      const event = {
        httpMethod: 'POST',
        body: null,
        headers: {},
      };

      const response = await advancedBooking(event);
      
      expect(response.statusCode).toBe(400);
      
      const data = JSON.parse(response.body);
      expect(data.error).toBe('Request body is required');
    });

    test('should include request ID in error responses', async () => {
      const event = {
        httpMethod: 'POST',
        body: null,
        headers: {},
      };

      const response = await advancedBooking(event);
      
      expect(response.headers).toBeDefined();
      expect(response.headers['X-Request-ID']).toBeDefined();
      expect(response.headers['X-Processing-Time']).toBeDefined();
    });
  });

  describe('Performance and Monitoring', () => {
    test('should include performance metrics in response headers', async () => {
      mockPrisma.afspraak.findMany.mockResolvedValue([]);
      mockPrisma.blockedDate.findFirst.mockResolvedValue(null);

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ date: '2024-01-15' }),
        headers: {},
      };

      const response = await advancedAvailability(event);
      
      expect(response.headers['X-Processing-Time']).toBeDefined();
      expect(response.headers['X-Processing-Time']).toMatch(/\d+ms/);
    });

    test('should handle concurrent requests efficiently', async () => {
      mockPrisma.afspraak.findMany.mockResolvedValue([]);
      mockPrisma.blockedDate.findFirst.mockResolvedValue(null);

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ date: '2024-01-15' }),
        headers: {},
      };

      const promises = Array(10).fill().map(() => advancedAvailability(event));
      const responses = await Promise.all(promises);

      responses.forEach(response => {
        expect(response.statusCode).toBe(200);
      });

      // Verify database connections were managed properly
      expect(mockPrisma.$disconnect).toHaveBeenCalledTimes(10);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_API_KEY;
  });
});