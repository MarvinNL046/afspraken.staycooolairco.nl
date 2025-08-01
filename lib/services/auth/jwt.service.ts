/**
 * JWT Token Service
 * 
 * Secure token generation and validation for the booking system.
 * Implements best practices for JWT security.
 */

import jwt, { JwtPayload, SignOptions, VerifyOptions } from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { securityConfig } from '@/lib/config/security';

// Token payload interfaces
export interface BookingTokenPayload extends JwtPayload {
  leadId: string;
  email: string;
  purpose: 'booking';
  sessionId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RefreshTokenPayload extends JwtPayload {
  leadId: string;
  sessionId: string;
  purpose: 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Custom error class for JWT errors
export class JWTError extends Error {
  constructor(
    message: string,
    public code: 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'INVALID_SIGNATURE' | 'INVALID_AUDIENCE' | 'INVALID_ISSUER'
  ) {
    super(message);
    this.name = 'JWTError';
  }
}

export class JWTService {
  private readonly secret: string;
  private readonly config = securityConfig.jwt;

  constructor() {
    const secret = process.env.JWT_SECRET_KEY;
    if (!secret) {
      throw new Error('JWT_SECRET_KEY environment variable is not set');
    }
    if (secret.length < 32) {
      throw new Error('JWT_SECRET_KEY must be at least 32 characters long');
    }
    this.secret = secret;
  }

  /**
   * Generate a secure session ID
   */
  generateSessionId(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generate a booking token for a validated lead
   */
  async generateBookingToken(
    leadId: string,
    email: string,
    metadata?: { ipAddress?: string; userAgent?: string }
  ): Promise<TokenPair> {
    const sessionId = this.generateSessionId();
    const now = Math.floor(Date.now() / 1000);

    // Access token payload
    const accessPayload: BookingTokenPayload = {
      leadId,
      email,
      purpose: 'booking',
      sessionId,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      iat: now,
      exp: now + 3600, // 1 hour
      iss: this.config.issuer,
      aud: this.config.audience,
      jti: randomBytes(16).toString('hex'), // Unique token ID
    };

    // Refresh token payload
    const refreshPayload: RefreshTokenPayload = {
      leadId,
      sessionId,
      purpose: 'refresh',
      iat: now,
      exp: now + 604800, // 7 days
      iss: this.config.issuer,
      aud: this.config.audience,
      jti: randomBytes(16).toString('hex'),
    };

    const signOptions: SignOptions = {
      algorithm: this.config.algorithm,
    };

    const accessToken = jwt.sign(accessPayload, this.secret, signOptions);
    const refreshToken = jwt.sign(refreshPayload, this.secret, signOptions);

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
    };
  }

  /**
   * Verify and decode a booking token
   */
  async verifyBookingToken(token: string): Promise<BookingTokenPayload> {
    try {
      const verifyOptions: VerifyOptions = {
        algorithms: [this.config.algorithm],
        issuer: this.config.issuer,
        audience: this.config.audience,
        clockTolerance: this.config.clockTolerance,
      };

      const decoded = jwt.verify(token, this.secret, verifyOptions) as BookingTokenPayload;

      // Additional validation
      if (decoded.purpose !== 'booking') {
        throw new JWTError('Invalid token purpose', 'INVALID_TOKEN');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new JWTError('Token has expired', 'EXPIRED_TOKEN');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        if (error.message.includes('signature')) {
          throw new JWTError('Invalid token signature', 'INVALID_SIGNATURE');
        }
        if (error.message.includes('audience')) {
          throw new JWTError('Invalid token audience', 'INVALID_AUDIENCE');
        }
        if (error.message.includes('issuer')) {
          throw new JWTError('Invalid token issuer', 'INVALID_ISSUER');
        }
      }
      throw new JWTError('Invalid token', 'INVALID_TOKEN');
    }
  }

  /**
   * Verify and decode a refresh token
   */
  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      const verifyOptions: VerifyOptions = {
        algorithms: [this.config.algorithm],
        issuer: this.config.issuer,
        audience: this.config.audience,
        clockTolerance: this.config.clockTolerance,
      };

      const decoded = jwt.verify(token, this.secret, verifyOptions) as RefreshTokenPayload;

      // Additional validation
      if (decoded.purpose !== 'refresh') {
        throw new JWTError('Invalid token purpose', 'INVALID_TOKEN');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new JWTError('Refresh token has expired', 'EXPIRED_TOKEN');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new JWTError('Invalid refresh token', 'INVALID_TOKEN');
      }
      throw new JWTError('Invalid refresh token', 'INVALID_TOKEN');
    }
  }

  /**
   * Refresh an access token using a valid refresh token
   */
  async refreshAccessToken(
    refreshToken: string,
    metadata?: { ipAddress?: string; userAgent?: string }
  ): Promise<TokenPair> {
    const decoded = await this.verifyRefreshToken(refreshToken);
    
    // Generate new token pair with same session ID
    return this.generateBookingToken(
      decoded.leadId,
      '', // Email will be fetched from database
      metadata
    );
  }

  /**
   * Decode token without verification (for logging purposes only)
   */
  decodeToken(token: string): JwtPayload | null {
    try {
      return jwt.decode(token) as JwtPayload;
    } catch {
      return null;
    }
  }

  /**
   * Check if a token is close to expiration (within 5 minutes)
   */
  isTokenExpiringSoon(token: string): boolean {
    try {
      const decoded = this.decodeToken(token);
      if (!decoded || !decoded.exp) return true;
      
      const now = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = decoded.exp - now;
      
      return timeUntilExpiry < 300; // Less than 5 minutes
    } catch {
      return true;
    }
  }
}

// Export singleton instance
export const jwtService = new JWTService();