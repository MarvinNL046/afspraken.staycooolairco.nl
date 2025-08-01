/**
 * Input Validation Middleware
 * 
 * Comprehensive input validation and sanitization for all API endpoints
 * Following OWASP input validation best practices
 */

import { z, ZodError, ZodSchema } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import DOMPurify from 'isomorphic-dompurify';
import { logger } from '@/lib/services/logging/logger';
import { AppError, ErrorCode, ErrorSeverity } from '@/lib/errors/types';

// Common validation schemas
export const commonSchemas = {
  // Email validation
  email: z.string()
    .email('Ongeldig e-mailadres')
    .max(254, 'E-mailadres is te lang')
    .transform(val => val.toLowerCase().trim()),
    
  // Dutch phone number validation
  phone: z.string()
    .regex(/^[\d\s\+\-\(\)]+$/, 'Ongeldig telefoonnummer')
    .min(10, 'Telefoonnummer is te kort')
    .max(20, 'Telefoonnummer is te lang')
    .transform(val => val.replace(/\s+/g, '')),
    
  // Name validation
  name: z.string()
    .min(2, 'Naam is te kort')
    .max(100, 'Naam is te lang')
    .regex(/^[a-zA-ZÀ-ÿ\s\-']+$/, 'Naam bevat ongeldige tekens')
    .transform(val => val.trim()),
    
  // Address validation
  address: z.string()
    .min(5, 'Adres is te kort')
    .max(200, 'Adres is te lang')
    .transform(val => val.trim()),
    
  // Postcode validation (Dutch format)
  postcode: z.string()
    .regex(/^[1-9][0-9]{3}\s?[A-Z]{2}$/i, 'Ongeldige postcode')
    .transform(val => val.toUpperCase().replace(/\s+/g, '')),
    
  // City validation
  city: z.string()
    .min(2, 'Plaatsnaam is te kort')
    .max(100, 'Plaatsnaam is te lang')
    .regex(/^[a-zA-ZÀ-ÿ\s\-']+$/, 'Plaatsnaam bevat ongeldige tekens')
    .transform(val => val.trim()),
    
  // Date validation
  date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ongeldige datum')
    .refine(val => {
      const date = new Date(val);
      return !isNaN(date.getTime()) && date >= new Date();
    }, 'Datum moet in de toekomst liggen'),
    
  // Time validation
  time: z.string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Ongeldige tijd'),
    
  // UUID validation
  uuid: z.string()
    .uuid('Ongeldige ID'),
    
  // GoHighLevel ID validation
  ghlId: z.string()
    .regex(/^[a-zA-Z0-9_-]+$/, 'Ongeldige GoHighLevel ID')
    .max(100, 'GoHighLevel ID is te lang'),
    
  // Service type validation
  serviceType: z.enum(['onderhoud', 'storing', 'installatie'])
    .describe('Ongeldig servicetype'),
    
  // Notes validation
  notes: z.string()
    .max(1000, 'Notities zijn te lang')
    .optional()
    .transform(val => val ? sanitizeHtml(val) : val),
};

/**
 * Sanitize HTML input
 */
function sanitizeHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
}

/**
 * Deep sanitize object to prevent prototype pollution
 */
export function deepSanitize(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    // Remove null bytes and control characters
    return obj.replace(/[\x00-\x1F\x7F]/g, '');
  }
  
  if (Array.isArray(obj)) {
    return obj.map(deepSanitize);
  }
  
  if (typeof obj === 'object') {
    const sanitized: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Prevent prototype pollution
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        logger.warn('Prototype pollution attempt detected', { key });
        continue;
      }
      
      // Skip keys with suspicious patterns
      if (key.includes('..') || key.includes('\\') || key.includes('\x00')) {
        logger.warn('Suspicious key detected', { key });
        continue;
      }
      
      sanitized[key] = deepSanitize(value);
    }
    
    return sanitized;
  }
  
  return obj;
}

/**
 * Validation schemas for different endpoints
 */
export const validationSchemas = {
  // Booking validation
  createBooking: z.object({
    naam: commonSchemas.name,
    email: commonSchemas.email,
    telefoon: commonSchemas.phone,
    adres: commonSchemas.address,
    postcode: commonSchemas.postcode,
    stad: commonSchemas.city,
    datum: commonSchemas.date,
    tijd: commonSchemas.time,
    serviceType: commonSchemas.serviceType,
    beschrijving: commonSchemas.notes.optional(),
    ghlLeadId: commonSchemas.ghlId.optional(),
  }),
  
  // Appointment creation
  createAppointment: z.object({
    leadId: commonSchemas.uuid.optional(),
    customerId: commonSchemas.uuid.optional(),
    datum: commonSchemas.date,
    tijd: commonSchemas.time,
    duur: z.number().min(30).max(480).default(120),
    locatie: commonSchemas.address,
    serviceType: commonSchemas.serviceType,
    beschrijving: commonSchemas.notes.optional(),
    prioriteit: z.number().min(0).max(2).default(0),
  }).refine(data => data.leadId || data.customerId, {
    message: 'Either leadId or customerId must be provided',
  }),
  
  // Availability check
  checkAvailability: z.object({
    date: commonSchemas.date,
    serviceType: commonSchemas.serviceType,
    address: commonSchemas.address.optional(),
    postcode: commonSchemas.postcode.optional(),
  }),
  
  // Token validation
  validateToken: z.object({
    token: z.string().min(1, 'Token is verplicht'),
    leadId: commonSchemas.uuid.optional(),
  }),
  
  // Status update
  updateStatus: z.object({
    appointmentId: commonSchemas.uuid,
    status: z.enum(['gepland', 'bevestigd', 'voltooid', 'geannuleerd', 'gemist']),
    reason: commonSchemas.notes.optional(),
  }),
};

/**
 * Validate request body against schema
 */
export async function validateRequestBody<T>(
  request: NextRequest,
  schema: ZodSchema<T>
): Promise<{ data: T | null; error: NextResponse | null }> {
  try {
    // Parse request body
    let body: any;
    const contentType = request.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      try {
        body = await request.json();
      } catch (e) {
        return {
          data: null,
          error: NextResponse.json(
            {
              error: {
                message: 'Ongeldige JSON in request body',
                code: ErrorCode.VALIDATION_ERROR,
              },
            },
            { status: 400 }
          ),
        };
      }
    } else {
      return {
        data: null,
        error: NextResponse.json(
          {
            error: {
              message: 'Content-Type moet application/json zijn',
              code: ErrorCode.VALIDATION_ERROR,
            },
          },
          { status: 415 }
        ),
      };
    }
    
    // Sanitize input first
    const sanitized = deepSanitize(body);
    
    // Validate against schema
    const validated = await schema.parseAsync(sanitized);
    
    return { data: validated, error: null };
    
  } catch (error) {
    if (error instanceof ZodError) {
      // Format validation errors
      const formattedErrors = error.issues.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      
      logger.warn('Input validation failed', {
        errors: formattedErrors,
        path: request.nextUrl.pathname,
      });
      
      return {
        data: null,
        error: NextResponse.json(
          {
            error: {
              message: 'Validatie mislukt',
              code: ErrorCode.VALIDATION_ERROR,
              details: formattedErrors,
            },
          },
          { status: 400 }
        ),
      };
    }
    
    // Other errors
    logger.error('Unexpected validation error', error as Error);
    
    return {
      data: null,
      error: NextResponse.json(
        {
          error: {
            message: 'Er is een fout opgetreden bij het valideren van de gegevens',
            code: ErrorCode.INTERNAL_ERROR,
          },
        },
        { status: 500 }
      ),
    };
  }
}

/**
 * Validation middleware wrapper
 */
export function withValidation<T>(
  schema: ZodSchema<T>,
  handler: (request: NextRequest, data: T) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const { data, error } = await validateRequestBody(request, schema);
    
    if (error) {
      return error;
    }
    
    return handler(request, data!);
  };
}

/**
 * SQL injection prevention helpers
 */
export const sqlSanitizers = {
  // Escape special characters for SQL
  escapeSql(input: string): string {
    return input
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\x00/g, '\\0')
      .replace(/\x1a/g, '\\Z');
  },
  
  // Validate table/column names
  isValidIdentifier(name: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
  },
  
  // Sanitize ORDER BY input
  sanitizeOrderBy(field: string, allowedFields: string[]): string | null {
    const cleaned = field.toLowerCase().trim();
    return allowedFields.includes(cleaned) ? cleaned : null;
  },
  
  // Sanitize LIMIT input
  sanitizeLimit(limit: any, max: number = 100): number {
    const parsed = parseInt(limit, 10);
    if (isNaN(parsed) || parsed < 1) return 10;
    return Math.min(parsed, max);
  },
};

/**
 * Path traversal prevention
 */
export function sanitizePath(path: string): string {
  // Remove any path traversal attempts
  return path
    .replace(/\.\./g, '')
    .replace(/~\//g, '')
    .replace(/[\\\/]+/g, '/')
    .replace(/^\/+/, '');
}

/**
 * Command injection prevention
 */
export function sanitizeCommand(input: string): string {
  // Remove shell metacharacters
  return input.replace(/[;&|`$<>\\]/g, '');
}