import { Handler } from '@netlify/functions';
import { z, ZodError } from 'zod';
import { googleMaps } from '../../lib/google-maps';
import { TravelMode, LatLng, DutchAddress } from '../../types/google-maps';
import { ensureRedisConnection } from '../../lib/redis';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import jwt from 'jsonwebtoken';

// Validation schemas
const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const addressSchema = z.object({
  street: z.string(),
  houseNumber: z.string(),
  houseNumberExt: z.string().optional(),
  postalCode: z.string().regex(/^[1-9][0-9]{3}\s?[A-Z]{2}$/i),
  city: z.string(),
});

const locationSchema = z.union([
  latLngSchema,
  addressSchema,
  z.string(), // Full address string
]);

const calculateDistanceSchema = z.object({
  origin: locationSchema,
  destination: locationSchema,
  travelMode: z.nativeEnum(TravelMode).default(TravelMode.DRIVING),
  alternatives: z.boolean().default(false),
  departureTime: z.string().datetime().optional(),
  avoidTolls: z.boolean().default(false),
  avoidHighways: z.boolean().default(false),
  optimize: z.boolean().default(true),
  apiKey: z.string().optional(), // For admin access
});

const matrixCalculationSchema = z.object({
  origins: z.array(locationSchema).min(1).max(25),
  destinations: z.array(locationSchema).min(1).max(25),
  travelMode: z.nativeEnum(TravelMode).default(TravelMode.DRIVING),
  apiKey: z.string().optional(),
});

/**
 * Netlify Function to calculate distances and routes
 * Endpoint: /.netlify/functions/calculate-distance
 * Method: POST
 * 
 * Features:
 * - Single route calculation with traffic
 * - Distance matrix for multiple points
 * - Dutch-optimized routing (bicycle support)
 * - Performance caching
 * - Cost optimization through field masks
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('POST, OPTIONS');
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return createErrorResponse(405, 'Method not allowed');
  }

  try {
    // Parse request body
    if (!event.body) {
      return createErrorResponse(400, 'Request body is required');
    }

    const body = JSON.parse(event.body);

    // Ensure Redis is connected
    await ensureRedisConnection();

    // Check if this is a matrix calculation
    if (body.origins && body.destinations) {
      // Validate matrix request
      const validatedData = matrixCalculationSchema.parse(body);

      // Admin API key check for matrix calculations (higher cost)
      const adminApiKey = process.env.ADMIN_API_KEY || 'your-admin-api-key';
      if (validatedData.apiKey !== adminApiKey) {
        // Check JWT token for authenticated users
        const authHeader = event.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          return createErrorResponse(401, 'Authentication required', {
            message: 'Matrix calculations require authentication',
          });
        }

        // Verify JWT token
        try {
          const token = authHeader.substring(7);
          jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        } catch (error) {
          return createErrorResponse(401, 'Invalid or expired token');
        }
      }

      // Calculate distance matrix
      const matrix = await googleMaps.calculateDistanceMatrix(
        validatedData.origins,
        validatedData.destinations,
        validatedData.travelMode
      );

      // Get performance metrics
      const metrics = googleMaps.getPerformanceMetrics();

      return createResponse(200, {
        success: true,
        matrix,
        performance: {
          totalCalculations: validatedData.origins.length * validatedData.destinations.length,
          cacheHitRate: metrics.summary.cacheHitRate,
          averageLatency: metrics.summary.averageLatency.matrix,
          estimatedCost: (validatedData.origins.length * validatedData.destinations.length * 0.01).toFixed(2),
        },
      }, {
        'X-Matrix-Size': `${validatedData.origins.length}x${validatedData.destinations.length}`,
      });
    }

    // Single route calculation
    const validatedData = calculateDistanceSchema.parse(body);

    // Calculate route
    const route = await googleMaps.calculateRoute({
      origin: validatedData.origin,
      destination: validatedData.destination,
      travelMode: validatedData.travelMode,
      alternatives: validatedData.alternatives,
      avoidTolls: validatedData.avoidTolls,
      avoidHighways: validatedData.avoidHighways,
      language: 'nl',
      units: 'METRIC' as any,
      region: 'NL',
      departureTime: validatedData.departureTime ? new Date(validatedData.departureTime) : undefined,
    });

    // Parse the primary route
    const primaryRoute = route.routes[0];
    if (!primaryRoute) {
      return createErrorResponse(404, 'No route found', {
        message: 'Unable to find a route between the specified locations',
      });
    }

    // Format response
    const response = {
      distance: {
        meters: primaryRoute.distanceMeters,
        text: `${(primaryRoute.distanceMeters / 1000).toFixed(1)} km`,
      },
      duration: {
        seconds: parseInt(primaryRoute.duration.replace('s', '')),
        text: formatDuration(parseInt(primaryRoute.duration.replace('s', ''))),
      },
      staticDuration: primaryRoute.staticDuration ? {
        seconds: parseInt(primaryRoute.staticDuration.replace('s', '')),
        text: formatDuration(parseInt(primaryRoute.staticDuration.replace('s', ''))),
      } : undefined,
      polyline: primaryRoute.overviewPolyline,
      bounds: primaryRoute.bounds,
      alternatives: route.routes.slice(1).map(alt => ({
        distance: {
          meters: alt.distanceMeters,
          text: `${(alt.distanceMeters / 1000).toFixed(1)} km`,
        },
        duration: {
          seconds: parseInt(alt.duration.replace('s', '')),
          text: formatDuration(parseInt(alt.duration.replace('s', ''))),
        },
        polyline: alt.overviewPolyline,
      })),
      travelMode: validatedData.travelMode,
    };

    // Get performance metrics
    const metrics = googleMaps.getPerformanceMetrics();

    return createResponse(200, {
      success: true,
      route: response,
      performance: {
        cached: metrics.recent[metrics.recent.length - 1]?.cached || false,
        latency: metrics.recent[metrics.recent.length - 1]?.latency,
        cacheHitRate: metrics.summary.cacheHitRate,
      },
    }, {
      'X-Cache-Hit-Rate': metrics.summary.cacheHitRate.toFixed(2),
    });

  } catch (error) {
    console.error('Distance calculation error:', error);

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

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while calculating the distance',
    });
  }
};

// Helper function to format duration
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours} uur ${minutes} min`;
  }
  return `${minutes} min`;
}