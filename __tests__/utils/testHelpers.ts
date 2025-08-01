import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { faker } from '@faker-js/faker/locale/nl';

/**
 * Test data generators and utility functions
 */

export class TestDataGenerator {
  /**
   * Generate a valid Dutch postal code
   */
  static generatePostalCode(): string {
    const numbers = faker.number.int({ min: 1000, max: 9999 });
    const letters = faker.string.alpha({ length: 2, casing: 'upper' });
    return `${numbers}${letters}`;
  }

  /**
   * Generate a valid Dutch phone number
   */
  static generatePhoneNumber(): string {
    const prefix = faker.helpers.arrayElement(['06', '020', '010', '030', '040']);
    const suffix = faker.string.numeric(prefix === '06' ? 8 : 7);
    return prefix + suffix;
  }

  /**
   * Generate test user data
   */
  static generateUser(overrides: Partial<any> = {}) {
    return {
      email: faker.internet.email(),
      password: 'Test123!',
      name: faker.person.fullName(),
      phone: this.generatePhoneNumber(),
      role: 'USER',
      ...overrides,
    };
  }

  /**
   * Generate test appointment data
   */
  static generateAppointment(userId: string, overrides: Partial<any> = {}) {
    const scheduledDate = faker.date.future({ days: 30 });
    const duration = faker.helpers.arrayElement([60, 90, 120, 180]);
    
    return {
      userId,
      serviceType: faker.helpers.arrayElement([
        'AC_INSTALLATION',
        'AC_MAINTENANCE',
        'AC_REPAIR',
        'HEAT_PUMP_INSTALLATION',
        'EMERGENCY_REPAIR',
      ]),
      scheduledDate,
      scheduledEndDate: new Date(scheduledDate.getTime() + duration * 60 * 1000),
      address: faker.location.streetAddress(),
      city: faker.helpers.arrayElement(['Amsterdam', 'Rotterdam', 'Utrecht', 'Den Haag']),
      postalCode: this.generatePostalCode(),
      status: 'SCHEDULED',
      notes: faker.lorem.sentence(),
      ...overrides,
    };
  }

  /**
   * Generate test address within service area
   */
  static generateServiceAreaAddress() {
    const serviceAreas = [
      { city: 'Amsterdam', postalCodes: ['1000AA', '1012LM', '1015AB', '1017CD'] },
      { city: 'Rotterdam', postalCodes: ['3000AA', '3011AD', '3012CA', '3014AB'] },
      { city: 'Utrecht', postalCodes: ['3500AA', '3511AB', '3512JE', '3521AL'] },
      { city: 'Den Haag', postalCodes: ['2500AA', '2511CS', '2513BA', '2514JP'] },
    ];

    const area = faker.helpers.arrayElement(serviceAreas);
    const postalCode = faker.helpers.arrayElement(area.postalCodes);

    return {
      street: faker.location.streetAddress(),
      postalCode,
      city: area.city,
    };
  }
}

/**
 * Authentication helpers
 */
export class AuthHelpers {
  /**
   * Generate a valid JWT token for testing
   */
  static generateToken(user: { id: string; email: string; role: string }) {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  }

  /**
   * Generate an expired token
   */
  static generateExpiredToken(user: { id: string; email: string; role: string }) {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '-1h' }
    );
  }

  /**
   * Create authorization header
   */
  static createAuthHeader(token: string) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }
}

/**
 * Database helpers
 */
export class DatabaseHelpers {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Clean all test data
   */
  async cleanDatabase() {
    // Delete in correct order to respect foreign keys
    await this.prisma.appointmentStatusHistory.deleteMany();
    await this.prisma.appointment.deleteMany();
    await this.prisma.user.deleteMany();
    await this.prisma.technician.deleteMany();
    await this.prisma.serviceArea.deleteMany();
  }

  /**
   * Seed test service areas
   */
  async seedServiceAreas() {
    const areas = [
      {
        name: 'Amsterdam Noord-Holland',
        postalCode: '1000AA',
        city: 'Amsterdam',
        province: 'Noord-Holland',
        isActive: true,
      },
      {
        name: 'Rotterdam Zuid-Holland',
        postalCode: '3000AA',
        city: 'Rotterdam',
        province: 'Zuid-Holland',
        isActive: true,
      },
      {
        name: 'Utrecht',
        postalCode: '3500AA',
        city: 'Utrecht',
        province: 'Utrecht',
        isActive: true,
      },
    ];

    await this.prisma.serviceArea.createMany({
      data: areas,
      skipDuplicates: true,
    });
  }

  /**
   * Create test user with appointments
   */
  async createUserWithAppointments(appointmentCount: number = 3) {
    const user = await this.prisma.user.create({
      data: TestDataGenerator.generateUser(),
    });

    const appointments = await Promise.all(
      Array.from({ length: appointmentCount }, () =>
        this.prisma.appointment.create({
          data: TestDataGenerator.generateAppointment(user.id),
        })
      )
    );

    return { user, appointments };
  }
}

/**
 * API test helpers
 */
export class ApiHelpers {
  /**
   * Create a mock Next.js API request
   */
  static createMockRequest(options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    query?: Record<string, string>;
    cookies?: Record<string, string>;
  } = {}) {
    return {
      method: options.method || 'GET',
      headers: new Headers(options.headers || {}),
      body: options.body || null,
      query: options.query || {},
      cookies: options.cookies || {},
      url: 'http://localhost:3000/api/test',
    };
  }

  /**
   * Create a mock Next.js API response
   */
  static createMockResponse() {
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      getHeader: jest.fn(),
      redirect: jest.fn().mockReturnThis(),
      end: jest.fn(),
    };
    return res;
  }

  /**
   * Extract response data from mock response
   */
  static getResponseData(mockResponse: any) {
    const jsonCall = mockResponse.json.mock.calls[0];
    return jsonCall ? jsonCall[0] : null;
  }

  /**
   * Get response status from mock response
   */
  static getResponseStatus(mockResponse: any) {
    const statusCall = mockResponse.status.mock.calls[0];
    return statusCall ? statusCall[0] : 200;
  }
}

/**
 * Time helpers for testing
 */
export class TimeHelpers {
  /**
   * Get next business day
   */
  static getNextBusinessDay(date: Date = new Date()): Date {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    
    // Skip weekends
    while (nextDay.getDay() === 0 || nextDay.getDay() === 6) {
      nextDay.setDate(nextDay.getDate() + 1);
    }
    
    return nextDay;
  }

  /**
   * Get business hours time slot
   */
  static getBusinessHourSlot(date: Date, hour: number = 10): Date {
    const slot = new Date(date);
    slot.setHours(hour, 0, 0, 0);
    return slot;
  }

  /**
   * Generate available time slots for a date
   */
  static generateTimeSlots(date: Date, slotDuration: number = 60): Array<{ start: Date; end: Date }> {
    const slots = [];
    const startHour = 8;
    const endHour = 17;

    for (let hour = startHour; hour < endHour; hour++) {
      const start = new Date(date);
      start.setHours(hour, 0, 0, 0);
      
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + slotDuration);
      
      if (end.getHours() <= endHour) {
        slots.push({ start, end });
      }
    }

    return slots;
  }
}

/**
 * Assertion helpers
 */
export class AssertionHelpers {
  /**
   * Assert appointment data matches expected structure
   */
  static assertAppointmentStructure(appointment: any) {
    expect(appointment).toHaveProperty('id');
    expect(appointment).toHaveProperty('userId');
    expect(appointment).toHaveProperty('serviceType');
    expect(appointment).toHaveProperty('scheduledDate');
    expect(appointment).toHaveProperty('address');
    expect(appointment).toHaveProperty('city');
    expect(appointment).toHaveProperty('postalCode');
    expect(appointment).toHaveProperty('status');
  }

  /**
   * Assert user data matches expected structure
   */
  static assertUserStructure(user: any) {
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('name');
    expect(user).toHaveProperty('role');
    expect(user).not.toHaveProperty('password');
  }

  /**
   * Assert API error response
   */
  static assertErrorResponse(response: any, expectedStatus: number, errorMessage?: string) {
    expect(response.success).toBe(false);
    expect(response.error).toBeDefined();
    
    if (errorMessage) {
      expect(response.error).toContain(errorMessage);
    }
  }

  /**
   * Assert successful API response
   */
  static assertSuccessResponse(response: any) {
    expect(response.success).toBe(true);
    expect(response.data).toBeDefined();
  }
}