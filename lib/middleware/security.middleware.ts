/**
 * Security Middleware
 * 
 * Implements rate limiting and other security measures
 * for the StayCool appointment booking system.
 */

import { NextRequest, NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';
import { securityConfig } from '@/lib/config/security';

// Rate limiter storage
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// Rate limit stores
const rateLimitStores: Map<string, LRUCache<string, RateLimitEntry>> = new Map();

// Get or create rate limit store
function getRateLimitStore(key: string): LRUCache<string, RateLimitEntry> {
  if (!rateLimitStores.has(key)) {
    rateLimitStores.set(key, new LRUCache<string, RateLimitEntry>({
      max: 10000, // Max 10k unique IPs
      ttl: 60 * 60 * 1000, // 1 hour TTL
    }));
  }
  return rateLimitStores.get(key)!;
}

/**
 * Get client identifier for rate limiting
 */
function getClientIdentifier(request: NextRequest): string {
  // Use a combination of IP and user agent for identification
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  
  // Create a hash of IP + user agent for privacy
  const identifier = `${ip}:${userAgent}`;
  return createHash('sha256').update(identifier).digest('hex').substring(0, 16);
}

/**
 * Rate limiting middleware
 */
export async function withRateLimit(
  request: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>,
  limitKey: keyof typeof securityConfig.rateLimit = 'api'
): Promise<NextResponse> {
  const config = securityConfig.rateLimit[limitKey];
  const store = getRateLimitStore(limitKey);
  const clientId = getClientIdentifier(request);
  
  const now = Date.now();
  const entry = store.get(clientId) || { count: 0, resetTime: now + config.windowMs };
  
  // Reset if window has passed
  if (now > entry.resetTime) {
    entry.count = 0;
    entry.resetTime = now + config.windowMs;
  }
  
  entry.count++;
  store.set(clientId, entry);
  
  // Check if limit exceeded
  if (entry.count > config.max) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    
    const response = NextResponse.json(
      {
        error: {
          message: config.message,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter,
        },
      },
      { status: 429 }
    );
    
    // Add rate limit headers
    response.headers.set('X-RateLimit-Limit', config.max.toString());
    response.headers.set('X-RateLimit-Remaining', '0');
    response.headers.set('X-RateLimit-Reset', new Date(entry.resetTime).toISOString());
    response.headers.set('Retry-After', retryAfter.toString());
    
    return response;
  }
  
  // Process request
  const response = await handler(request);
  
  // Add rate limit headers to successful responses
  if (config.standardHeaders && response.status < 400) {
    response.headers.set('X-RateLimit-Limit', config.max.toString());
    response.headers.set('X-RateLimit-Remaining', (config.max - entry.count).toString());
    response.headers.set('X-RateLimit-Reset', new Date(entry.resetTime).toISOString());
  }
  
  return response;
}

/**
 * CSRF token generation (simplified implementation)
 */
export function generateCSRFToken(sessionId: string): string {
  const secret = process.env.JWT_SECRET_KEY || 'development-secret';
  const timestamp = Date.now().toString();
  const data = `${sessionId}:${timestamp}:${secret}`;
  return createHash('sha256').update(data).digest('hex');
}

/**
 * CSRF protection middleware (simplified)
 */
export async function withCSRFProtection(
  request: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  // Skip CSRF for GET requests
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return handler(request);
  }
  
  // For now, just pass through - implement full CSRF later
  return handler(request);
}

/**
 * IP-based blocking middleware
 */
const blockedIPs = new Set<string>();
const suspiciousActivity = new LRUCache<string, number>({
  max: 10000,
  ttl: 24 * 60 * 60 * 1000, // 24 hours
});

export async function withIPBlocking(
  request: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  const clientId = getClientIdentifier(request);
  
  // Check if IP is blocked
  if (blockedIPs.has(clientId)) {
    return NextResponse.json(
      {
        error: {
          message: 'Toegang geweigerd',
          code: 'ACCESS_DENIED',
        },
      },
      { status: 403 }
    );
  }
  
  // Track suspicious activity
  const suspiciousCount = suspiciousActivity.get(clientId) || 0;
  if (suspiciousCount > 10) {
    blockedIPs.add(clientId);
    return NextResponse.json(
      {
        error: {
          message: 'Toegang geblokkeerd vanwege verdachte activiteit',
          code: 'BLOCKED',
        },
      },
      { status: 403 }
    );
  }
  
  // Process request
  const response = await handler(request);
  
  // Track failed authentication attempts
  if (response.status === 401 || response.status === 403) {
    suspiciousActivity.set(clientId, suspiciousCount + 1);
  }
  
  return response;
}

/**
 * Combined security middleware
 */
export async function withSecurity(
  request: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>,
  options?: {
    rateLimit?: keyof typeof securityConfig.rateLimit;
    csrf?: boolean;
    ipBlocking?: boolean;
  }
): Promise<NextResponse> {
  const { rateLimit = 'api', csrf = true, ipBlocking = true } = options || {};
  
  // Apply IP blocking
  if (ipBlocking) {
    const ipBlockResult = await withIPBlocking(request, async (req) => req as any);
    if (ipBlockResult && ipBlockResult.status === 403) {
      return ipBlockResult;
    }
  }
  
  // Apply rate limiting
  return withRateLimit(request, async (req) => {
    // Apply CSRF protection
    if (csrf && req.method !== 'GET') {
      return withCSRFProtection(req, handler);
    }
    
    return handler(req);
  }, rateLimit);
}

/**
 * Request sanitization
 */
export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // Remove null bytes
    return input.replace(/\0/g, '');
  }
  
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  
  if (input && typeof input === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(input)) {
      // Skip prototype pollution attempts
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  
  return input;
}