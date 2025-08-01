/**
 * Security Configuration
 * 
 * Centralized security settings for the StayCool appointment system.
 * Following OWASP best practices and industry standards.
 */

export const securityConfig = {
  jwt: {
    // JWT token configuration
    algorithm: 'HS512' as const,
    issuer: 'staycool-appointments',
    audience: 'staycool-booking',
    expiresIn: '1h', // 1 hour for booking tokens
    refreshExpiresIn: '7d', // 7 days for refresh tokens
    clockTolerance: 10, // 10 seconds clock skew tolerance
  },
  
  encryption: {
    // Encryption settings
    algorithm: 'aes-256-gcm',
    ivLength: 16,
    saltRounds: 12, // bcrypt salt rounds
    tagLength: 16,
  },
  
  rateLimit: {
    // Rate limiting configuration per endpoint
    booking: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 booking requests per window
      message: 'Te veel boekingsverzoeken. Probeer het later opnieuw.',
      standardHeaders: true,
      legacyHeaders: false,
    },
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 auth requests per window
      message: 'Te veel authenticatiepogingen. Probeer het later opnieuw.',
      standardHeaders: true,
      legacyHeaders: false,
    },
    api: {
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 60, // 60 requests per minute for general API
      message: 'Te veel API-verzoeken. Vertraag uw verzoeken.',
      standardHeaders: true,
      legacyHeaders: false,
    },
  },
  
  csrf: {
    // CSRF protection settings
    cookieName: '__Host-staycool-csrf',
    cookieOptions: {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },
  },
  
  headers: {
    // Security headers configuration
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.googletagmanager.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://api.staycoolairco.nl'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  },
  
  validation: {
    // Input validation settings
    email: {
      maxLength: 254,
      pattern: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
    },
    phone: {
      maxLength: 20,
      pattern: /^[\d\s\+\-\(\)]+$/,
    },
    ghlId: {
      maxLength: 100,
      pattern: /^[a-zA-Z0-9_-]+$/,
    },
  },
  
  logging: {
    // Security logging configuration
    enableSecurityLogs: true,
    logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
    sensitiveFields: ['password', 'token', 'refresh_token', 'api_key', 'secret'],
  },
};

// Environment variable validation
export function validateSecurityEnv(): void {
  const required = ['JWT_SECRET_KEY', 'DATABASE_URL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required security environment variables: ${missing.join(', ')}`);
  }
  
  // Validate JWT secret strength
  const jwtSecret = process.env.JWT_SECRET_KEY;
  if (jwtSecret && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET_KEY must be at least 32 characters long');
  }
}