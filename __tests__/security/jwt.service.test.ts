/**
 * JWT Service Security Tests
 * 
 * Comprehensive tests for JWT token generation and validation
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { jwtService, JWTError } from '@/lib/services/auth/jwt.service';
import jwt from 'jsonwebtoken';

describe('JWT Service Security Tests', () => {
  // Set up test environment
  beforeAll(() => {
    process.env.JWT_SECRET_KEY = 'test-secret-key-that-is-at-least-32-characters-long';
  });

  describe('Token Generation', () => {
    it('should generate valid booking token pair', async () => {
      const leadId = 'test-lead-123';
      const email = 'test@example.com';
      
      const tokenPair = await jwtService.generateBookingToken(leadId, email);
      
      expect(tokenPair).toHaveProperty('accessToken');
      expect(tokenPair).toHaveProperty('refreshToken');
      expect(tokenPair).toHaveProperty('expiresIn');
      expect(tokenPair.expiresIn).toBe(3600);
    });

    it('should include correct claims in access token', async () => {
      const leadId = 'test-lead-123';
      const email = 'test@example.com';
      const metadata = { ipAddress: '192.168.1.1', userAgent: 'Test Browser' };
      
      const tokenPair = await jwtService.generateBookingToken(leadId, email, metadata);
      const decoded = jwt.decode(tokenPair.accessToken) as any;
      
      expect(decoded.leadId).toBe(leadId);
      expect(decoded.email).toBe(email);
      expect(decoded.purpose).toBe('booking');
      expect(decoded.sessionId).toBeDefined();
      expect(decoded.ipAddress).toBe(metadata.ipAddress);
      expect(decoded.userAgent).toBe(metadata.userAgent);
      expect(decoded.iss).toBe('staycool-appointments');
      expect(decoded.aud).toBe('staycool-booking');
    });

    it('should generate unique session IDs', async () => {
      const token1 = await jwtService.generateBookingToken('lead1', 'test1@example.com');
      const token2 = await jwtService.generateBookingToken('lead2', 'test2@example.com');
      
      const decoded1 = jwt.decode(token1.accessToken) as any;
      const decoded2 = jwt.decode(token2.accessToken) as any;
      
      expect(decoded1.sessionId).not.toBe(decoded2.sessionId);
    });
  });

  describe('Token Validation', () => {
    it('should validate a valid booking token', async () => {
      const tokenPair = await jwtService.generateBookingToken('lead-123', 'test@example.com');
      
      const payload = await jwtService.verifyBookingToken(tokenPair.accessToken);
      
      expect(payload.leadId).toBe('lead-123');
      expect(payload.email).toBe('test@example.com');
      expect(payload.purpose).toBe('booking');
    });

    it('should reject token with invalid signature', async () => {
      const tokenPair = await jwtService.generateBookingToken('lead-123', 'test@example.com');
      const tampered = tokenPair.accessToken.slice(0, -10) + 'tampered123';
      
      await expect(jwtService.verifyBookingToken(tampered))
        .rejects.toThrow(JWTError);
      
      try {
        await jwtService.verifyBookingToken(tampered);
      } catch (error) {
        expect(error).toBeInstanceOf(JWTError);
        expect((error as JWTError).code).toBe('INVALID_SIGNATURE');
      }
    });

    it('should reject expired token', async () => {
      // Create an expired token
      const expiredToken = jwt.sign(
        {
          leadId: 'test-lead',
          email: 'test@example.com',
          purpose: 'booking',
          sessionId: 'test-session',
          exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        },
        process.env.JWT_SECRET_KEY!,
        { algorithm: 'HS512' }
      );
      
      await expect(jwtService.verifyBookingToken(expiredToken))
        .rejects.toThrow(JWTError);
      
      try {
        await jwtService.verifyBookingToken(expiredToken);
      } catch (error) {
        expect(error).toBeInstanceOf(JWTError);
        expect((error as JWTError).code).toBe('EXPIRED_TOKEN');
      }
    });

    it('should reject token with wrong purpose', async () => {
      const wrongPurposeToken = jwt.sign(
        {
          leadId: 'test-lead',
          email: 'test@example.com',
          purpose: 'wrong-purpose',
          sessionId: 'test-session',
          iss: 'staycool-appointments',
          aud: 'staycool-booking',
        },
        process.env.JWT_SECRET_KEY!,
        { algorithm: 'HS512', expiresIn: '1h' }
      );
      
      await expect(jwtService.verifyBookingToken(wrongPurposeToken))
        .rejects.toThrow(JWTError);
    });

    it('should reject token with wrong issuer', async () => {
      const wrongIssuerToken = jwt.sign(
        {
          leadId: 'test-lead',
          email: 'test@example.com',
          purpose: 'booking',
          sessionId: 'test-session',
          iss: 'wrong-issuer',
          aud: 'staycool-booking',
        },
        process.env.JWT_SECRET_KEY!,
        { algorithm: 'HS512', expiresIn: '1h' }
      );
      
      await expect(jwtService.verifyBookingToken(wrongIssuerToken))
        .rejects.toThrow(JWTError);
    });
  });

  describe('Refresh Token', () => {
    it('should validate refresh token', async () => {
      const tokenPair = await jwtService.generateBookingToken('lead-123', 'test@example.com');
      
      const payload = await jwtService.verifyRefreshToken(tokenPair.refreshToken);
      
      expect(payload.leadId).toBe('lead-123');
      expect(payload.purpose).toBe('refresh');
    });

    it('should refresh access token with valid refresh token', async () => {
      const originalPair = await jwtService.generateBookingToken('lead-123', 'test@example.com');
      
      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const newPair = await jwtService.refreshAccessToken(originalPair.refreshToken);
      
      expect(newPair.accessToken).toBeDefined();
      expect(newPair.accessToken).not.toBe(originalPair.accessToken);
      expect(newPair.refreshToken).toBeDefined();
    });
  });

  describe('Token Expiry Detection', () => {
    it('should detect token expiring soon', () => {
      const expiringSoonToken = jwt.sign(
        {
          exp: Math.floor(Date.now() / 1000) + 240, // 4 minutes from now
        },
        'test-secret'
      );
      
      expect(jwtService.isTokenExpiringSoon(expiringSoonToken)).toBe(true);
    });

    it('should not flag token with plenty of time left', () => {
      const freshToken = jwt.sign(
        {
          exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        },
        'test-secret'
      );
      
      expect(jwtService.isTokenExpiringSoon(freshToken)).toBe(false);
    });
  });

  describe('Security Edge Cases', () => {
    it('should handle malformed tokens gracefully', async () => {
      const malformedTokens = [
        'not.a.token',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        '',
        'null',
        '{}',
      ];
      
      for (const token of malformedTokens) {
        await expect(jwtService.verifyBookingToken(token))
          .rejects.toThrow(JWTError);
      }
    });

    it('should not expose sensitive information in errors', async () => {
      try {
        await jwtService.verifyBookingToken('invalid-token');
      } catch (error) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).not.toContain(process.env.JWT_SECRET_KEY);
        expect(errorMessage).not.toContain('secret');
      }
    });
  });
});