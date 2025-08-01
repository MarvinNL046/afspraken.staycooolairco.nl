import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { appointmentService } from '@/lib/services/appointmentService';
import { PrismaClient } from '@prisma/client';
import { googleMapsService } from '@/lib/services/googleMapsService';
import { googleCalendarService } from '@/lib/services/googleCalendarService';
import { cacheService } from '@/lib/services/cacheService';
import { routeOptimizationService } from '@/lib/services/routeOptimizationService';

// Mock dependencies
jest.mock('@prisma/client');
jest.mock('@/lib/services/googleMapsService');
jest.mock('@/lib/services/googleCalendarService');
jest.mock('@/lib/services/cacheService');
jest.mock('@/lib/services/routeOptimizationService');

describe('AppointmentService', () => {
  let mockPrisma: jest.Mocked<PrismaClient>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = new PrismaClient() as jest.Mocked<PrismaClient>;
  });

  describe('createAppointment', () => {
    it('should create appointment with address validation', async () => {
      // Arrange
      const appointmentData = {
        userId: '123',
        serviceType: 'AC_INSTALLATION',
        address: 'Hoofdstraat 123',
        postalCode: '1234AB',
        city: 'Amsterdam',
        scheduledDate: new Date('2024-01-15T10:00:00Z'),
        duration: 60,
        notes: 'Test appointment',
      };

      const validatedAddress = {
        formatted_address: 'Hoofdstraat 123, 1234 AB Amsterdam, Netherlands',
        lat: 52.3676,
        lng: 4.9041,
        place_id: 'test-place-id',
      };

      const calendarEvent = {
        id: 'calendar-event-id',
        htmlLink: 'https://calendar.google.com/event?id=calendar-event-id',
      };

      const createdAppointment = {
        id: 'appointment-123',
        ...appointmentData,
        status: 'SCHEDULED',
        calendarEventId: calendarEvent.id,
      };

      (googleMapsService.validateAddress as jest.Mock).mockResolvedValue(validatedAddress);
      (googleCalendarService.createEvent as jest.Mock).mockResolvedValue(calendarEvent);
      mockPrisma.appointment.create = jest.fn().mockResolvedValue(createdAppointment);
      mockPrisma.serviceArea.findFirst = jest.fn().mockResolvedValue({ id: 'area-1' });

      // Act
      const result = await appointmentService.createAppointment(appointmentData);

      // Assert
      expect(googleMapsService.validateAddress).toHaveBeenCalledWith({
        address: appointmentData.address,
        postalCode: appointmentData.postalCode,
        city: appointmentData.city,
      });
      
      expect(mockPrisma.serviceArea.findFirst).toHaveBeenCalledWith({
        where: {
          postalCode: appointmentData.postalCode,
          isActive: true,
        },
      });

      expect(googleCalendarService.createEvent).toHaveBeenCalledWith({
        summary: `AC Installation - ${appointmentData.address}`,
        description: expect.stringContaining('Service: AC_INSTALLATION'),
        location: validatedAddress.formatted_address,
        start: appointmentData.scheduledDate,
        end: expect.any(Date),
      });

      expect(mockPrisma.appointment.create).toHaveBeenCalled();
      expect(result).toEqual(createdAppointment);
    });

    it('should throw error for invalid service area', async () => {
      // Arrange
      const appointmentData = {
        userId: '123',
        serviceType: 'AC_MAINTENANCE',
        address: 'Invalid Street 999',
        postalCode: '9999XX',
        city: 'UnknownCity',
        scheduledDate: new Date('2024-01-15T10:00:00Z'),
      };

      (googleMapsService.validateAddress as jest.Mock).mockResolvedValue({
        formatted_address: 'Invalid Street 999, 9999 XX UnknownCity',
        lat: 50.0,
        lng: 5.0,
      });
      
      mockPrisma.serviceArea.findFirst = jest.fn().mockResolvedValue(null);

      // Act & Assert
      await expect(
        appointmentService.createAppointment(appointmentData)
      ).rejects.toThrow('Service not available in this area');
    });

    it('should check availability before creating appointment', async () => {
      // Arrange
      const appointmentData = {
        userId: '123',
        serviceType: 'AC_REPAIR',
        address: 'Teststraat 1',
        postalCode: '1000AA',
        city: 'Amsterdam',
        scheduledDate: new Date('2024-01-15T10:00:00Z'),
        duration: 90,
      };

      // Mock conflicting appointment
      mockPrisma.appointment.findMany = jest.fn().mockResolvedValue([{
        id: 'existing-appointment',
        scheduledDate: new Date('2024-01-15T09:30:00Z'),
        scheduledEndDate: new Date('2024-01-15T10:30:00Z'),
      }]);

      (googleMapsService.validateAddress as jest.Mock).mockResolvedValue({
        formatted_address: 'Teststraat 1, 1000 AA Amsterdam',
        lat: 52.37,
        lng: 4.90,
      });

      mockPrisma.serviceArea.findFirst = jest.fn().mockResolvedValue({ id: 'area-1' });

      // Act & Assert
      await expect(
        appointmentService.createAppointment(appointmentData)
      ).rejects.toThrow('Time slot not available');
    });
  });

  describe('updateAppointment', () => {
    it('should update appointment and sync with calendar', async () => {
      // Arrange
      const appointmentId = 'appointment-123';
      const updateData = {
        scheduledDate: new Date('2024-01-16T14:00:00Z'),
        notes: 'Rescheduled appointment',
      };

      const existingAppointment = {
        id: appointmentId,
        userId: '123',
        serviceType: 'AC_INSTALLATION',
        scheduledDate: new Date('2024-01-15T10:00:00Z'),
        calendarEventId: 'calendar-event-id',
        status: 'SCHEDULED',
      };

      const updatedAppointment = {
        ...existingAppointment,
        ...updateData,
      };

      mockPrisma.appointment.findUnique = jest.fn().mockResolvedValue(existingAppointment);
      mockPrisma.appointment.update = jest.fn().mockResolvedValue(updatedAppointment);
      (googleCalendarService.updateEvent as jest.Mock).mockResolvedValue({
        id: 'calendar-event-id',
        status: 'confirmed',
      });

      // Act
      const result = await appointmentService.updateAppointment(appointmentId, updateData);

      // Assert
      expect(mockPrisma.appointment.findUnique).toHaveBeenCalledWith({
        where: { id: appointmentId },
      });

      expect(googleCalendarService.updateEvent).toHaveBeenCalledWith(
        existingAppointment.calendarEventId,
        expect.objectContaining({
          start: updateData.scheduledDate,
        })
      );

      expect(mockPrisma.appointment.update).toHaveBeenCalledWith({
        where: { id: appointmentId },
        data: updateData,
      });

      expect(result).toEqual(updatedAppointment);
    });

    it('should create status history on status change', async () => {
      // Arrange
      const appointmentId = 'appointment-123';
      const updateData = {
        status: 'COMPLETED',
        completedAt: new Date(),
      };

      const existingAppointment = {
        id: appointmentId,
        status: 'IN_PROGRESS',
        technicianId: 'tech-123',
      };

      mockPrisma.appointment.findUnique = jest.fn().mockResolvedValue(existingAppointment);
      mockPrisma.appointment.update = jest.fn().mockResolvedValue({
        ...existingAppointment,
        ...updateData,
      });
      mockPrisma.appointmentStatusHistory.create = jest.fn();

      // Act
      await appointmentService.updateAppointment(appointmentId, updateData);

      // Assert
      expect(mockPrisma.appointmentStatusHistory.create).toHaveBeenCalledWith({
        data: {
          appointmentId,
          previousStatus: 'IN_PROGRESS',
          newStatus: 'COMPLETED',
          changedBy: expect.any(String),
          reason: expect.any(String),
        },
      });
    });
  });

  describe('cancelAppointment', () => {
    it('should cancel appointment and remove from calendar', async () => {
      // Arrange
      const appointmentId = 'appointment-123';
      const reason = 'Customer requested cancellation';

      const appointment = {
        id: appointmentId,
        status: 'SCHEDULED',
        calendarEventId: 'calendar-event-id',
        userId: '123',
      };

      mockPrisma.appointment.findUnique = jest.fn().mockResolvedValue(appointment);
      mockPrisma.appointment.update = jest.fn().mockResolvedValue({
        ...appointment,
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason,
      });
      (googleCalendarService.deleteEvent as jest.Mock).mockResolvedValue(true);

      // Act
      const result = await appointmentService.cancelAppointment(appointmentId, reason);

      // Assert
      expect(googleCalendarService.deleteEvent).toHaveBeenCalledWith(
        appointment.calendarEventId
      );

      expect(mockPrisma.appointment.update).toHaveBeenCalledWith({
        where: { id: appointmentId },
        data: {
          status: 'CANCELLED',
          cancelledAt: expect.any(Date),
          cancellationReason: reason,
        },
      });

      expect(result.status).toBe('CANCELLED');
    });

    it('should throw error if appointment already completed', async () => {
      // Arrange
      const appointmentId = 'appointment-123';
      const appointment = {
        id: appointmentId,
        status: 'COMPLETED',
      };

      mockPrisma.appointment.findUnique = jest.fn().mockResolvedValue(appointment);

      // Act & Assert
      await expect(
        appointmentService.cancelAppointment(appointmentId, 'Test reason')
      ).rejects.toThrow('Cannot cancel completed appointment');
    });
  });

  describe('getAvailableSlots', () => {
    it('should return available time slots', async () => {
      // Arrange
      const date = new Date('2024-01-15');
      const serviceType = 'AC_INSTALLATION';
      const duration = 120;

      const existingAppointments = [
        {
          scheduledDate: new Date('2024-01-15T09:00:00Z'),
          scheduledEndDate: new Date('2024-01-15T11:00:00Z'),
        },
        {
          scheduledDate: new Date('2024-01-15T14:00:00Z'),
          scheduledEndDate: new Date('2024-01-15T15:00:00Z'),
        },
      ];

      mockPrisma.appointment.findMany = jest.fn().mockResolvedValue(existingAppointments);
      (cacheService.get as jest.Mock).mockResolvedValue(null);
      (cacheService.set as jest.Mock).mockResolvedValue(undefined);

      // Act
      const result = await appointmentService.getAvailableSlots(date, serviceType, duration);

      // Assert
      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith({
        where: {
          scheduledDate: {
            gte: expect.any(Date),
            lt: expect.any(Date),
          },
          status: {
            notIn: ['CANCELLED'],
          },
        },
        orderBy: { scheduledDate: 'asc' },
      });

      // Should have slots that don't conflict with existing appointments
      expect(result).toContainEqual(
        expect.objectContaining({
          start: expect.any(String),
          end: expect.any(String),
          available: true,
        })
      );

      // Should not have slots during existing appointments
      const bookedSlot = result.find(
        slot => slot.start === '2024-01-15T09:00:00Z'
      );
      expect(bookedSlot).toBeUndefined();
    });

    it('should use cache when available', async () => {
      // Arrange
      const date = new Date('2024-01-15');
      const cachedSlots = [
        { start: '09:00', end: '10:00', available: true },
        { start: '10:00', end: '11:00', available: false },
      ];

      (cacheService.get as jest.Mock).mockResolvedValue(cachedSlots);

      // Act
      const result = await appointmentService.getAvailableSlots(date, 'AC_REPAIR', 60);

      // Assert
      expect(cacheService.get).toHaveBeenCalled();
      expect(mockPrisma.appointment.findMany).not.toHaveBeenCalled();
      expect(result).toEqual(cachedSlots);
    });
  });

  describe('optimizeRoutes', () => {
    it('should optimize routes for technician appointments', async () => {
      // Arrange
      const date = new Date('2024-01-15');
      const technicianId = 'tech-123';

      const appointments = [
        {
          id: 'apt-1',
          address: 'Address 1',
          lat: 52.3676,
          lng: 4.9041,
          scheduledDate: new Date('2024-01-15T09:00:00Z'),
        },
        {
          id: 'apt-2',
          address: 'Address 2',
          lat: 52.3700,
          lng: 4.9100,
          scheduledDate: new Date('2024-01-15T11:00:00Z'),
        },
      ];

      const optimizedRoute = {
        appointments: ['apt-2', 'apt-1'], // Reordered
        totalDistance: 15000,
        totalDuration: 1800,
        polyline: 'encoded-polyline',
      };

      mockPrisma.appointment.findMany = jest.fn().mockResolvedValue(appointments);
      (routeOptimizationService.optimizeRoute as jest.Mock).mockResolvedValue(optimizedRoute);

      // Act
      const result = await appointmentService.optimizeRoutes(date, technicianId);

      // Assert
      expect(routeOptimizationService.optimizeRoute).toHaveBeenCalledWith(
        appointments,
        { algorithm: 'nearest-neighbor' }
      );

      expect(result).toEqual(optimizedRoute);
    });
  });
});