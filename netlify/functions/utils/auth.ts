/**
 * Authentication utilities for serverless functions
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Validate internal API key
 */
export function validateApiKey(key: string | null): boolean {
  if (!key || !process.env.INTERNAL_API_KEY) {
    return false;
  }
  
  // Use timing-safe comparison to prevent timing attacks
  const keyBuffer = Buffer.from(key);
  const expectedBuffer = Buffer.from(process.env.INTERNAL_API_KEY);
  
  if (keyBuffer.length !== expectedBuffer.length) {
    return false;
  }
  
  return timingSafeEqual(keyBuffer, expectedBuffer);
}

/**
 * Validate webhook signature
 */
export function validateWebhookSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }
  
  const expectedSignature = createHmac('sha256', secret)
    .update(body)
    .digest('hex');
    
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  
  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }
  
  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

/**
 * Extract bearer token from authorization header
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }
  
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Generate secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return require('crypto').randomBytes(length).toString('hex');
}