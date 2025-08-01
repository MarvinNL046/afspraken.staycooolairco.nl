import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { authService } from '@/lib/services/authService';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Mock dependencies
jest.mock('@prisma/client');
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

describe('AuthService', () => {
  let mockPrisma: jest.Mocked<PrismaClient>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = new PrismaClient() as jest.Mocked<PrismaClient>;
  });

  describe('register', () => {
    it('should create a new user with hashed password', async () => {
      // Arrange
      const userData = {
        email: 'test@example.com',
        password: 'Test123!',
        name: 'Test User',
      };
      
      const hashedPassword = 'hashed-password';
      const createdUser = {
        id: '123',
        email: userData.email,
        name: userData.name,
        role: 'USER',
        createdAt: new Date(),
      };

      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      mockPrisma.user.create = jest.fn().mockResolvedValue(createdUser);

      // Act
      const result = await authService.register(userData);

      // Assert
      expect(bcrypt.hash).toHaveBeenCalledWith(userData.password, 12);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          email: userData.email,
          password: hashedPassword,
          name: userData.name,
        },
      });
      expect(result).toEqual({
        id: createdUser.id,
        email: createdUser.email,
        name: createdUser.name,
        role: createdUser.role,
      });
    });

    it('should throw error if email already exists', async () => {
      // Arrange
      const userData = {
        email: 'existing@example.com',
        password: 'Test123!',
        name: 'Test User',
      };

      mockPrisma.user.create = jest.fn().mockRejectedValue({
        code: 'P2002',
        meta: { target: ['email'] },
      });

      // Act & Assert
      await expect(authService.register(userData)).rejects.toThrow(
        'Email already registered'
      );
    });

    it('should validate password strength', async () => {
      // Arrange
      const weakPasswords = ['123456', 'password', 'abc', ''];

      // Act & Assert
      for (const password of weakPasswords) {
        await expect(
          authService.register({
            email: 'test@example.com',
            password,
            name: 'Test User',
          })
        ).rejects.toThrow('Password does not meet security requirements');
      }
    });
  });

  describe('login', () => {
    it('should authenticate user with correct credentials', async () => {
      // Arrange
      const credentials = {
        email: 'test@example.com',
        password: 'Test123!',
      };
      
      const user = {
        id: '123',
        email: credentials.email,
        password: 'hashed-password',
        role: 'USER',
        name: 'Test User',
      };
      
      const token = 'jwt-token';

      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwt.sign as jest.Mock).mockReturnValue(token);

      // Act
      const result = await authService.login(credentials);

      // Assert
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: credentials.email },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        credentials.password,
        user.password
      );
      expect(jwt.sign).toHaveBeenCalledWith(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      expect(result).toEqual({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        token,
      });
    });

    it('should throw error for invalid credentials', async () => {
      // Arrange
      const credentials = {
        email: 'test@example.com',
        password: 'WrongPassword',
      };

      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);

      // Act & Assert
      await expect(authService.login(credentials)).rejects.toThrow(
        'Invalid email or password'
      );
    });

    it('should handle rate limiting', async () => {
      // Arrange
      const credentials = {
        email: 'test@example.com',
        password: 'Test123!',
      };

      // Simulate multiple failed attempts
      for (let i = 0; i < 5; i++) {
        mockPrisma.user.findUnique = jest.fn().mockResolvedValue({
          id: '123',
          email: credentials.email,
          password: 'hashed-password',
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);
        
        try {
          await authService.login(credentials);
        } catch (e) {
          // Expected to fail
        }
      }

      // Act & Assert - 6th attempt should be rate limited
      await expect(authService.login(credentials)).rejects.toThrow(
        'Too many login attempts. Please try again later.'
      );
    });
  });

  describe('verifyToken', () => {
    it('should verify valid JWT token', async () => {
      // Arrange
      const token = 'valid-jwt-token';
      const decoded = {
        userId: '123',
        email: 'test@example.com',
        role: 'USER',
        iat: Date.now() / 1000,
        exp: Date.now() / 1000 + 86400,
      };

      (jwt.verify as jest.Mock).mockReturnValue(decoded);

      // Act
      const result = await authService.verifyToken(token);

      // Assert
      expect(jwt.verify).toHaveBeenCalledWith(token, process.env.JWT_SECRET);
      expect(result).toEqual({
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      });
    });

    it('should throw error for invalid token', async () => {
      // Arrange
      const token = 'invalid-token';
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      // Act & Assert
      await expect(authService.verifyToken(token)).rejects.toThrow(
        'Invalid or expired token'
      );
    });

    it('should throw error for expired token', async () => {
      // Arrange
      const token = 'expired-token';
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new jwt.TokenExpiredError('Token expired', new Date());
      });

      // Act & Assert
      await expect(authService.verifyToken(token)).rejects.toThrow(
        'Token has expired'
      );
    });
  });

  describe('refreshToken', () => {
    it('should generate new token for valid refresh token', async () => {
      // Arrange
      const refreshToken = 'valid-refresh-token';
      const decoded = {
        userId: '123',
        email: 'test@example.com',
        role: 'USER',
        type: 'refresh',
      };
      const newToken = 'new-jwt-token';

      (jwt.verify as jest.Mock).mockReturnValue(decoded);
      (jwt.sign as jest.Mock).mockReturnValue(newToken);

      // Act
      const result = await authService.refreshToken(refreshToken);

      // Assert
      expect(jwt.verify).toHaveBeenCalledWith(
        refreshToken,
        process.env.JWT_REFRESH_SECRET
      );
      expect(jwt.sign).toHaveBeenCalledWith(
        { userId: decoded.userId, email: decoded.email, role: decoded.role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      expect(result).toEqual({ token: newToken });
    });
  });

  describe('changePassword', () => {
    it('should update password for authenticated user', async () => {
      // Arrange
      const userId = '123';
      const passwordData = {
        currentPassword: 'OldPassword123!',
        newPassword: 'NewPassword123!',
      };
      
      const user = {
        id: userId,
        password: 'old-hashed-password',
      };
      
      const newHashedPassword = 'new-hashed-password';

      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue(newHashedPassword);
      mockPrisma.user.update = jest.fn().mockResolvedValue({
        ...user,
        password: newHashedPassword,
      });

      // Act
      await authService.changePassword(userId, passwordData);

      // Assert
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        passwordData.currentPassword,
        user.password
      );
      expect(bcrypt.hash).toHaveBeenCalledWith(passwordData.newPassword, 12);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { password: newHashedPassword },
      });
    });

    it('should throw error if current password is incorrect', async () => {
      // Arrange
      const userId = '123';
      const passwordData = {
        currentPassword: 'WrongPassword',
        newPassword: 'NewPassword123!',
      };

      mockPrisma.user.findUnique = jest.fn().mockResolvedValue({
        id: userId,
        password: 'hashed-password',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      // Act & Assert
      await expect(
        authService.changePassword(userId, passwordData)
      ).rejects.toThrow('Current password is incorrect');
    });
  });
});