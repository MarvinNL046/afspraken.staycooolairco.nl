import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z, ZodError } from 'zod';
import { googleMaps, addressToLatLng } from '../../lib/google-maps';
import { DutchAddress } from '../../types/google-maps';
import { redis, ensureRedisConnection } from '../../lib/redis';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';

const prisma = new PrismaClient();

// Validation schema for Dutch address
const dutchAddressSchema = z.object({
  street: z.string().min(1, 'Street is required'),
  houseNumber: z.string().regex(/^\d+$/, 'House number must be numeric'),
  houseNumberExt: z.string().optional(),
  postalCode: z.string().regex(/^[1-9][0-9]{3}\s?[A-Z]{2}$/i, 'Invalid Dutch postal code'),
  city: z.string().min(1, 'City is required'),
  country: z.string().default('Netherlands'),
});

// Batch geocoding schema
const batchGeocodeSchema = z.object({
  addresses: z.array(dutchAddressSchema).min(1).max(25),
});

/**
 * Netlify Function to geocode Dutch addresses
 * Endpoint: /.netlify/functions/geocode-address
 * Methods: GET (single), POST (batch)
 * 
 * GET Query params: street, houseNumber, houseNumberExt, postalCode, city
 * POST Body: { addresses: DutchAddress[] }
 * 
 * Features:
 * - Dutch address format optimization
 * - Multi-layer caching (memory + Redis + database)
 * - Batch geocoding support
 * - Performance monitoring
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('GET, POST, OPTIONS');
  }

  // Only allow GET and POST requests
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return createErrorResponse(405, 'Method not allowed');
  }

  try {
    // Ensure Redis is connected
    await ensureRedisConnection();

    // Handle single address geocoding (GET)
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      
      // Validate address components
      const validatedAddress = dutchAddressSchema.parse({
        street: params.street,
        houseNumber: params.houseNumber,
        houseNumberExt: params.houseNumberExt,
        postalCode: params.postalCode,
        city: params.city,
        country: params.country,
      });

      // Check if address already geocoded in database
      const existingCustomer = await prisma.customer.findFirst({
        where: {
          address: `${validatedAddress.street} ${validatedAddress.houseNumber}${validatedAddress.houseNumberExt || ''}`,
          postalCode: validatedAddress.postalCode,
          city: validatedAddress.city,
          latitude: { not: null },
          longitude: { not: null },
        },
        select: {
          latitude: true,
          longitude: true,
          placeId: true,
          geocodeAccuracy: true,
        },
      });

      if (existingCustomer && existingCustomer.latitude && existingCustomer.longitude) {
        return createResponse(200, {
          success: true,
          result: {
            latitude: existingCustomer.latitude,
            longitude: existingCustomer.longitude,
            placeId: existingCustomer.placeId,
            accuracy: existingCustomer.geocodeAccuracy,
            cached: true,
            cacheType: 'database',
          },
        }, {
          'X-Cache': 'database',
        });
      }

      // Geocode the address
      const result = await googleMaps.geocodeAddress(validatedAddress);

      // Get performance metrics
      const metrics = googleMaps.getPerformanceMetrics();

      return createResponse(200, {
        success: true,
        result,
        performance: {
          latency: metrics.recent[metrics.recent.length - 1]?.latency,
          cached: false,
        },
      }, {
        'X-Cache': 'miss',
        'X-Performance-Latency': metrics.recent[metrics.recent.length - 1]?.latency.toString() || '0',
      });
    }

    // Handle batch geocoding (POST)
    if (event.httpMethod === 'POST') {
      if (!event.body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const body = JSON.parse(event.body);
      const validatedData = batchGeocodeSchema.parse(body);

      // Batch geocode addresses
      const results = await googleMaps.batchGeocodeAddresses(validatedData.addresses);

      // Get performance metrics
      const metrics = googleMaps.getPerformanceMetrics();
      const cacheStats = await redis.getStats();

      return createResponse(200, {
        success: true,
        results,
        performance: {
          totalAddresses: validatedData.addresses.length,
          geocoded: results.filter(r => r !== null).length,
          cacheHitRate: metrics.summary.cacheHitRate,
          averageLatency: metrics.summary.averageLatency.geocoding,
          cacheStats,
        },
      });
    }

    // This should never be reached due to method validation above
    return createErrorResponse(500, 'Internal server error');

  } catch (error) {
    console.error('Geocoding error:', error);

    // Handle validation errors
    if (error instanceof ZodError) {
      return createErrorResponse(400, 'Validation error', {
        details: error.issues,
      });
    }

    // Handle rate limit errors
    if (error instanceof Error && error.message.includes('rate limit')) {
      return createErrorResponse(429, 'Rate limit exceeded', {
        message: 'Please try again in 60 seconds',
      }, {
        'Retry-After': '60',
      });
    }

    // Handle quota errors
    if (error instanceof Error && error.message.includes('quota')) {
      return createErrorResponse(403, 'Daily quota exceeded', {
        message: 'Google Maps API daily quota has been exceeded',
      });
    }

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while geocoding the address',
    });
  } finally {
    // Ensure database connection is closed
    await prisma.$disconnect();
  }
};