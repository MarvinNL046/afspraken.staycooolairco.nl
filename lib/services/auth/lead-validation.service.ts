/**
 * Lead Validation Service
 * 
 * Validates leads from the database and ensures they are authorized
 * to create bookings. Implements security checks and rate limiting.
 */

import { PrismaClient, Lead } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { securityConfig } from '@/lib/config/security';

// Validation result interface
export interface LeadValidationResult {
  isValid: boolean;
  lead?: Lead;
  error?: string;
  requiresVerification?: boolean;
}

// Verification code interface
export interface VerificationCode {
  code: string;
  expiresAt: Date;
  attempts: number;
}

// Custom error class for validation errors
export class LeadValidationError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'INACTIVE' | 'BLOCKED' | 'INVALID_CREDENTIALS' | 'VERIFICATION_REQUIRED'
  ) {
    super(message);
    this.name = 'LeadValidationError';
  }
}

export class LeadValidationService {
  private prisma: PrismaClient;
  private verificationCodes: Map<string, VerificationCode> = new Map();
  private failedAttempts: Map<string, number> = new Map();
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    // Clean up expired codes every 5 minutes
    setInterval(() => this.cleanupExpiredCodes(), 5 * 60 * 1000);
  }

  /**
   * Validate a lead by email and GoHighLevel ID
   */
  async validateLead(email: string, ghlId: string): Promise<LeadValidationResult> {
    try {
      // Check if email is blocked due to failed attempts
      if (this.isEmailBlocked(email)) {
        throw new LeadValidationError(
          'Account tijdelijk geblokkeerd vanwege te veel mislukte pogingen',
          'BLOCKED'
        );
      }

      // Validate input format
      this.validateInput(email, ghlId);

      // Find lead in database
      const lead = await this.prisma.lead.findFirst({
        where: {
          email: email.toLowerCase(),
          ghlId: ghlId,
        },
      });

      if (!lead) {
        this.recordFailedAttempt(email);
        throw new LeadValidationError(
          'Geen geldige lead gevonden met deze gegevens',
          'NOT_FOUND'
        );
      }

      // Additional security checks
      if (this.isLeadSuspicious(lead)) {
        return {
          isValid: false,
          requiresVerification: true,
          error: 'Extra verificatie vereist voor deze account',
        };
      }

      // Clear failed attempts on successful validation
      this.failedAttempts.delete(email);

      return {
        isValid: true,
        lead,
      };
    } catch (error) {
      if (error instanceof LeadValidationError) {
        throw error;
      }
      throw new Error('Fout bij het valideren van lead gegevens');
    }
  }

  /**
   * Validate a lead by email only (for verification code flow)
   */
  async validateLeadByEmail(email: string): Promise<Lead | null> {
    try {
      const lead = await this.prisma.lead.findUnique({
        where: {
          email: email.toLowerCase(),
        },
      });

      return lead;
    } catch {
      return null;
    }
  }

  /**
   * Generate and send a verification code
   */
  async generateVerificationCode(email: string): Promise<string> {
    // Check if email exists
    const lead = await this.validateLeadByEmail(email);
    if (!lead) {
      throw new LeadValidationError(
        'Geen account gevonden met dit e-mailadres',
        'NOT_FOUND'
      );
    }

    // Generate 6-digit code
    const code = this.generateSecureCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store verification code
    this.verificationCodes.set(email.toLowerCase(), {
      code,
      expiresAt,
      attempts: 0,
    });

    // In production, send email here
    // For now, return the code (in production, this would be sent via email)
    return code;
  }

  /**
   * Verify a code
   */
  async verifyCode(email: string, code: string): Promise<boolean> {
    const storedCode = this.verificationCodes.get(email.toLowerCase());
    
    if (!storedCode) {
      throw new LeadValidationError(
        'Geen verificatiecode gevonden. Vraag een nieuwe aan.',
        'VERIFICATION_REQUIRED'
      );
    }

    // Check expiration
    if (new Date() > storedCode.expiresAt) {
      this.verificationCodes.delete(email.toLowerCase());
      throw new LeadValidationError(
        'Verificatiecode is verlopen. Vraag een nieuwe aan.',
        'VERIFICATION_REQUIRED'
      );
    }

    // Check attempts
    if (storedCode.attempts >= 3) {
      this.verificationCodes.delete(email.toLowerCase());
      throw new LeadValidationError(
        'Te veel mislukte pogingen. Vraag een nieuwe code aan.',
        'VERIFICATION_REQUIRED'
      );
    }

    // Verify code
    if (storedCode.code !== code) {
      storedCode.attempts++;
      return false;
    }

    // Success - remove code
    this.verificationCodes.delete(email.toLowerCase());
    return true;
  }

  /**
   * Validate input format
   */
  private validateInput(email: string, ghlId: string): void {
    const { validation } = securityConfig;

    // Validate email
    if (!email || !validation.email.pattern.test(email)) {
      throw new LeadValidationError(
        'Ongeldig e-mailadres formaat',
        'INVALID_CREDENTIALS'
      );
    }

    if (email.length > validation.email.maxLength) {
      throw new LeadValidationError(
        'E-mailadres is te lang',
        'INVALID_CREDENTIALS'
      );
    }

    // Validate GHL ID
    if (!ghlId || !validation.ghlId.pattern.test(ghlId)) {
      throw new LeadValidationError(
        'Ongeldig GoHighLevel ID formaat',
        'INVALID_CREDENTIALS'
      );
    }

    if (ghlId.length > validation.ghlId.maxLength) {
      throw new LeadValidationError(
        'GoHighLevel ID is te lang',
        'INVALID_CREDENTIALS'
      );
    }
  }

  /**
   * Check if a lead appears suspicious and requires extra verification
   */
  private isLeadSuspicious(lead: Lead): boolean {
    // Check for suspicious patterns
    const daysSinceCreation = (Date.now() - lead.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    
    // New leads (less than 1 hour old) require verification
    if (daysSinceCreation < 1/24) {
      return true;
    }

    // Check for rapid changes in lead data (would need additional fields in real implementation)
    // For now, return false
    return false;
  }

  /**
   * Check if an email is blocked due to failed attempts
   */
  private isEmailBlocked(email: string): boolean {
    const attempts = this.failedAttempts.get(email.toLowerCase()) || 0;
    return attempts >= this.MAX_FAILED_ATTEMPTS;
  }

  /**
   * Record a failed login attempt
   */
  private recordFailedAttempt(email: string): void {
    const key = email.toLowerCase();
    const current = this.failedAttempts.get(key) || 0;
    this.failedAttempts.set(key, current + 1);

    // Auto-remove after lockout duration
    if (current + 1 >= this.MAX_FAILED_ATTEMPTS) {
      setTimeout(() => {
        this.failedAttempts.delete(key);
      }, this.LOCKOUT_DURATION);
    }
  }

  /**
   * Generate a secure 6-digit verification code
   */
  private generateSecureCode(): string {
    const buffer = randomBytes(3);
    const num = buffer.readUIntBE(0, 3);
    return String(num % 1000000).padStart(6, '0');
  }

  /**
   * Clean up expired verification codes
   */
  private cleanupExpiredCodes(): void {
    const now = new Date();
    for (const [email, code] of this.verificationCodes.entries()) {
      if (now > code.expiresAt) {
        this.verificationCodes.delete(email);
      }
    }
  }

  /**
   * Get remaining lockout time for an email
   */
  getRemainingLockoutTime(email: string): number {
    const attempts = this.failedAttempts.get(email.toLowerCase()) || 0;
    if (attempts < this.MAX_FAILED_ATTEMPTS) {
      return 0;
    }
    // In a real implementation, we'd track the timestamp of the last attempt
    return this.LOCKOUT_DURATION;
  }
}

// Export factory function
export function createLeadValidationService(prisma: PrismaClient): LeadValidationService {
  return new LeadValidationService(prisma);
}