import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import { createServer } from 'http';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { NextApiHandler } from 'next';

// Mock Next.js API handler wrapper
const createTestHandler = (handler: NextApiHandler) => {
  return createServer(async (req, res) => {
    const mockReq = {
      ...req,
      query: {},
      cookies: {},
      body: await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({});
          }
        });
      }),
    };
    
    await handler(mockReq as any, res as any);
  });
};

describe('Appointments API Integration Tests', () => {
  let prisma: PrismaClient;
  let authToken: string;
  let testUser: any;

  beforeEach(async () => {
    // Initialize database connection
    prisma = new PrismaClient();
    
    // Create test user
    testUser = await prisma.user.create({
      data: {
        email: 'integration@test.com',
        password: '$2a$12$test.hashed.password',
        name: 'Integration Test User',
        phone: '0612345678',
        role: 'USER',
      },
    });

    // Generate auth token
    authToken = jwt.sign(
      { userId: testUser.id, email: testUser.email, role: testUser.role },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.appointment.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    await prisma.$disconnect();
  });

  describe('POST /api/appointments', () => {
    it('should create a new appointment with valid data', async () => {
      // Arrange
      const appointmentData = {
        serviceType: 'AC_INSTALLATION',
        address: 'Teststraat 123',
        postalCode: '1000AA',
        city: 'Amsterdam',
        scheduledDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
        duration: 120,
        notes: 'Integration test appointment',
      };

      // Act
      const response = await request('http://localhost:3000')
        .post('/api/appointments')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(appointmentData);

      // Assert
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: expect.any(String),
          userId: testUser.id,
          serviceType: appointmentData.serviceType,
          address: appointmentData.address,
          status: 'SCHEDULED',
          calendarEventId: expect.any(String),
        },
      });

      // Verify in database
      const appointment = await prisma.appointment.findUnique({
        where: { id: response.body.data.id },
      });
      expect(appointment).toBeTruthy();
      expect(appointment?.userId).toBe(testUser.id);
    });

    it('should validate service area before creating appointment', async () => {
      // Arrange
      const appointmentData = {
        serviceType: 'AC_MAINTENANCE',
        address: 'Invalid Street 999',
        postalCode: '9999XX',
        city: 'UnknownCity',
        scheduledDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      };

      // Act
      const response = await request('http://localhost:3000')
        .post('/api/appointments')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(appointmentData);

      // Assert
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('service area'),
      });
    });

    it('should check availability conflicts', async () => {
      // Arrange - Create existing appointment
      const existingAppointment = await prisma.appointment.create({
        data: {
          userId: testUser.id,
          serviceType: 'AC_REPAIR',
          scheduledDate: new Date('2024-01-20T10:00:00Z'),
          scheduledEndDate: new Date('2024-01-20T12:00:00Z'),
          address: 'Existing Street 1',
          city: 'Amsterdam',
          postalCode: '1000AA',
          status: 'SCHEDULED',
        },
      });

      // Try to book overlapping appointment
      const conflictingData = {
        serviceType: 'AC_INSTALLATION',
        address: 'New Street 2',
        postalCode: '1000AA',
        city: 'Amsterdam',
        scheduledDate: '2024-01-20T11:00:00Z', // Overlaps with existing
        duration: 120,
      };

      // Act
      const response = await request('http://localhost:3000')
        .post('/api/appointments')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(conflictingData);

      // Assert
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('time slot'),
      });
    });

    it('should require authentication', async () => {
      // Act
      const response = await request('http://localhost:3000')
        .post('/api/appointments')
        .set('Content-Type', 'application/json')
        .send({
          serviceType: 'AC_REPAIR',
          address: 'Test Street',
          scheduledDate: new Date().toISOString(),
        });

      // Assert
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        success: false,
        error: 'Authentication required',
      });
    });
  });

  describe('GET /api/appointments', () => {
    it('should return user appointments with pagination', async () => {
      // Arrange - Create test appointments
      const appointments = await Promise.all([
        prisma.appointment.create({
          data: {
            userId: testUser.id,
            serviceType: 'AC_INSTALLATION',
            scheduledDate: new Date('2024-01-15T10:00:00Z'),
            scheduledEndDate: new Date('2024-01-15T12:00:00Z'),
            address: 'Test 1',
            city: 'Amsterdam',
            postalCode: '1000AA',
            status: 'SCHEDULED',
          },
        }),
        prisma.appointment.create({
          data: {
            userId: testUser.id,
            serviceType: 'AC_REPAIR',
            scheduledDate: new Date('2024-01-16T14:00:00Z'),
            scheduledEndDate: new Date('2024-01-16T15:00:00Z'),
            address: 'Test 2',
            city: 'Amsterdam',
            postalCode: '1000AA',
            status: 'COMPLETED',
          },
        }),
      ]);

      // Act
      const response = await request('http://localhost:3000')
        .get('/api/appointments')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          appointments: expect.arrayContaining([
            expect.objectContaining({
              id: appointments[0].id,
              serviceType: 'AC_INSTALLATION',
              status: 'SCHEDULED',
            }),
            expect.objectContaining({
              id: appointments[1].id,
              serviceType: 'AC_REPAIR',
              status: 'COMPLETED',
            }),
          ]),
          pagination: {
            page: 1,
            limit: 10,
            total: 2,
            totalPages: 1,
          },
        },
      });
    });

    it('should filter appointments by status', async () => {
      // Arrange
      await Promise.all([
        prisma.appointment.create({
          data: {
            userId: testUser.id,
            serviceType: 'AC_INSTALLATION',
            scheduledDate: new Date(),
            scheduledEndDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
            address: 'Scheduled 1',
            city: 'Amsterdam',
            postalCode: '1000AA',
            status: 'SCHEDULED',
          },
        }),
        prisma.appointment.create({
          data: {
            userId: testUser.id,
            serviceType: 'AC_REPAIR',
            scheduledDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
            scheduledEndDate: new Date(Date.now() - 22 * 60 * 60 * 1000),
            address: 'Completed 1',
            city: 'Amsterdam',
            postalCode: '1000AA',
            status: 'COMPLETED',
          },
        }),
      ]);

      // Act
      const response = await request('http://localhost:3000')
        .get('/api/appointments')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ status: 'SCHEDULED' });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.appointments).toHaveLength(1);
      expect(response.body.data.appointments[0].status).toBe('SCHEDULED');
    });
  });

  describe('PUT /api/appointments/:id', () => {
    it('should update appointment details', async () => {
      // Arrange
      const appointment = await prisma.appointment.create({
        data: {
          userId: testUser.id,
          serviceType: 'AC_MAINTENANCE',
          scheduledDate: new Date('2024-01-20T10:00:00Z'),
          scheduledEndDate: new Date('2024-01-20T11:00:00Z'),
          address: 'Original Address',
          city: 'Amsterdam',
          postalCode: '1000AA',
          status: 'SCHEDULED',
        },
      });

      const updateData = {
        scheduledDate: new Date('2024-01-21T14:00:00Z').toISOString(),
        notes: 'Rescheduled by customer',
      };

      // Act
      const response = await request('http://localhost:3000')
        .put(`/api/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(updateData);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: appointment.id,
          scheduledDate: updateData.scheduledDate,
          notes: updateData.notes,
        },
      });

      // Verify status history was created
      const statusHistory = await prisma.appointmentStatusHistory.findFirst({
        where: { appointmentId: appointment.id },
      });
      expect(statusHistory).toBeTruthy();
    });

    it('should not allow updating other users appointments', async () => {
      // Arrange
      const otherUser = await prisma.user.create({
        data: {
          email: 'other@test.com',
          password: 'hashed',
          name: 'Other User',
        },
      });

      const appointment = await prisma.appointment.create({
        data: {
          userId: otherUser.id,
          serviceType: 'AC_REPAIR',
          scheduledDate: new Date(),
          scheduledEndDate: new Date(Date.now() + 60 * 60 * 1000),
          address: 'Other User Address',
          city: 'Amsterdam',
          postalCode: '1000AA',
          status: 'SCHEDULED',
        },
      });

      // Act
      const response = await request('http://localhost:3000')
        .put(`/api/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send({ notes: 'Trying to update' });

      // Assert
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        success: false,
        error: 'Forbidden',
      });

      // Clean up
      await prisma.appointment.delete({ where: { id: appointment.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    });
  });

  describe('DELETE /api/appointments/:id', () => {
    it('should cancel appointment with reason', async () => {
      // Arrange
      const appointment = await prisma.appointment.create({
        data: {
          userId: testUser.id,
          serviceType: 'AC_INSTALLATION',
          scheduledDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
          scheduledEndDate: new Date(Date.now() + 50 * 60 * 60 * 1000),
          address: 'Cancel Test',
          city: 'Amsterdam',
          postalCode: '1000AA',
          status: 'SCHEDULED',
          calendarEventId: 'test-calendar-event',
        },
      });

      // Act
      const response = await request('http://localhost:3000')
        .delete(`/api/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send({ reason: 'Customer unavailable' });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: appointment.id,
          status: 'CANCELLED',
          cancellationReason: 'Customer unavailable',
        },
      });

      // Verify appointment was cancelled
      const cancelledAppointment = await prisma.appointment.findUnique({
        where: { id: appointment.id },
      });
      expect(cancelledAppointment?.status).toBe('CANCELLED');
      expect(cancelledAppointment?.cancelledAt).toBeTruthy();
    });

    it('should not allow cancelling completed appointments', async () => {
      // Arrange
      const appointment = await prisma.appointment.create({
        data: {
          userId: testUser.id,
          serviceType: 'AC_REPAIR',
          scheduledDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          scheduledEndDate: new Date(Date.now() - 22 * 60 * 60 * 1000),
          address: 'Completed Test',
          city: 'Amsterdam',
          postalCode: '1000AA',
          status: 'COMPLETED',
          completedAt: new Date(Date.now() - 22 * 60 * 60 * 1000),
        },
      });

      // Act
      const response = await request('http://localhost:3000')
        .delete(`/api/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send({ reason: 'Trying to cancel completed' });

      // Assert
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('completed'),
      });
    });
  });
});