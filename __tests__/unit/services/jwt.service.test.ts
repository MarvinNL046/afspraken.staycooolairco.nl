/**
 * JWT Service Unit Tests
 * 
 * Tests JWT token generation, validation, and session management
 */

import { JWTService } from '@/lib/services/auth/jwt.service';
import jwt from 'jsonwebtoken';
import { AppError, ErrorCode } from '@/lib/errors/types';

// Mock jsonwebtoken
jest.mock('jsonwebtoken');

describe('JWTService', () => {
  let jwtService: JWTService;
  const mockSecret = 'test-secret-key-that-is-at-least-32-characters-long';
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET_KEY = mockSecret;
    jwtService = new JWTService();
  });

  describe('generateBookingToken', () => {
    it('should generate a valid booking token', async () => {
      const mockToken = 'mock.jwt.token';
      const leadData = {
        leadId: 'lead-123',
        email: 'test@example.com',
        sessionId: 'session-123',
      };

      (jwt.sign as jest.Mock).mockReturnValue(mockToken);

      const result = await jwtService.generateBookingToken(leadData);

      expect(result).toEqual({
        token: mockToken,
        expiresIn: 3600,
      });

      expect(jwt.sign).toHaveBeenCalledWith(
        {
          leadId: leadData.leadId,
          email: leadData.email,
          sessionId: leadData.sessionId,
          type: 'booking',
        },
        mockSecret,
        {
          algorithm: 'HS512',
          expiresIn: '1h',
          issuer: 'staycool-appointments',
          audience: 'staycool-booking',
        }
      );
    });

    it('should handle missing lead data', async () => {
      await expect(
        jwtService.generateBookingToken({
          leadId: '',
          email: 'test@example.com',
          sessionId: 'session-123',
        })
      ).rejects.toThrow('Invalid lead data');
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', async () => {
      const mockPayload = {
        leadId: 'lead-123',
        email: 'test@example.com',
        sessionId: 'session-123',
        type: 'booking',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const result = await jwtService.verifyToken('valid.token');

      expect(result).toEqual({
        valid: true,
        payload: mockPayload,
      });

      expect(jwt.verify).toHaveBeenCalledWith(
        'valid.token',
        mockSecret,
        {
          algorithms: ['HS512'],
          issuer: 'staycool-appointments',
          audience: 'staycool-booking',
          clockTolerance: 10,
        }
      );
    });

    it('should handle expired tokens', async () => {
      const error = new Error('Token expired');
      (error as any).name = 'TokenExpiredError';
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw error;
      });

      const result = await jwtService.verifyToken('expired.token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token verlopen');
    });

    it('should handle invalid tokens', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const result = await jwtService.verifyToken('invalid.token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Ongeldige token');
    });
  });

  describe('refreshToken', () => {
    it('should refresh a valid token', async () => {
      const mockPayload = {
        leadId: 'lead-123',
        email: 'test@example.com',
        sessionId: 'session-123',
        type: 'refresh',
      };
      const newToken = 'new.jwt.token';

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);
      (jwt.sign as jest.Mock).mockReturnValue(newToken);

      const result = await jwtService.refreshToken('refresh.token');

      expect(result).toEqual({
        token: newToken,
        expiresIn: 3600,
      });
    });

    it('should throw error for non-refresh tokens', async () => {
      const mockPayload = {
        leadId: 'lead-123',
        email: 'test@example.com',
        sessionId: 'session-123',
        type: 'booking',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      await expect(
        jwtService.refreshToken('booking.token')
      ).rejects.toThrow(AppError);
    });
  });

  describe('revokeToken', () => {
    it('should add token to revoked list', async () => {
      const token = 'token.to.revoke';
      const mockPayload = {
        jti: 'jti-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      (jwt.decode as jest.Mock).mockReturnValue(mockPayload);

      await jwtService.revokeToken(token);

      expect(jwtService.isTokenRevoked('jti-123')).toBe(true);
    });

    it('should handle tokens without jti', async () => {
      const token = 'token.without.jti';
      const mockPayload = {
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      (jwt.decode as jest.Mock).mockReturnValue(mockPayload);

      await expect(
        jwtService.revokeToken(token)
      ).rejects.toThrow('Token does not contain jti');
    });
  });

  describe('cleanupRevokedTokens', () => {
    it('should remove expired tokens from revoked list', () => {
      // Mock internal revoked tokens
      const revokedTokens = new Map([
        ['expired-1', Date.now() - 1000],
        ['expired-2', Date.now() - 2000],
        ['valid-1', Date.now() + 1000],
      ]);

      // Access private property for testing
      (jwtService as any).revokedTokens = revokedTokens;

      const removed = jwtService.cleanupRevokedTokens();

      expect(removed).toBe(2);
      expect(jwtService.isTokenRevoked('expired-1')).toBe(false);
      expect(jwtService.isTokenRevoked('expired-2')).toBe(false);
      expect(jwtService.isTokenRevoked('valid-1')).toBe(true);
    });
  });

  describe('extractTokenFromHeader', () => {
    it('should extract Bearer token from authorization header', () => {
      const result = jwtService.extractTokenFromHeader('Bearer abc.def.ghi');
      expect(result).toBe('abc.def.ghi');
    });

    it('should return null for invalid format', () => {
      expect(jwtService.extractTokenFromHeader('InvalidFormat')).toBeNull();
      expect(jwtService.extractTokenFromHeader('bearer abc.def.ghi')).toBeNull();
      expect(jwtService.extractTokenFromHeader('')).toBeNull();
    });
  });
});