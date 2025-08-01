import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z, ZodError } from 'zod';
import { googleMaps } from '../../lib/google-maps';
import { TravelMode, LatLng } from '../../types/google-maps';
import { ensureRedisConnection } from '../../lib/redis';
import jwt from 'jsonwebtoken';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';

const prisma = new PrismaClient();

// Validation schemas
const waypointSchema = z.union([
  z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  z.object({
    address: z.string(),
  }),
  z.object({
    appointmentId: z.string().cuid(),
  }),
]);

const optimizeRouteSchema = z.object({
  origin: waypointSchema,
  destination: waypointSchema.optional(),
  waypoints: z.array(waypointSchema).min(1).max(25),
  travelMode: z.nativeEnum(TravelMode).default(TravelMode.DRIVING),
  routeClusterId: z.string().cuid().optional(),
  optimizationStrategy: z.enum(['time', 'distance']).default('time'),
  bookingToken: z.string().min(1, 'Authentication required'),
});

/**
 * Netlify Function to optimize routes with multiple waypoints
 * Endpoint: /.netlify/functions/optimize-route
 * Method: POST
 * 
 * Features:
 * - Waypoint optimization (up to 25 points)
 * - Appointment-based routing
 * - Route cluster support
 * - Dutch traffic patterns
 * - Bicycle routing optimization
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
    const validatedData = optimizeRouteSchema.parse(body);

    // Verify JWT token
    const tokenSecret = process.env.JWT_SECRET || 'your-secret-key';
    let tokenPayload: any;
    
    try {
      tokenPayload = jwt.verify(validatedData.bookingToken, tokenSecret) as any;
    } catch (error) {
      return createErrorResponse(401, 'Invalid or expired token');
    }

    // Ensure Redis is connected
    await ensureRedisConnection();

    // Resolve waypoints that are appointment IDs
    const resolvedWaypoints: (LatLng | string)[] = [];
    const appointmentMap = new Map<number, string>(); // Index to appointment ID

    for (let i = 0; i < validatedData.waypoints.length; i++) {
      const waypoint = validatedData.waypoints[i];
      
      if ('appointmentId' in waypoint) {
        // Fetch appointment details
        const appointment = await prisma.afspraak.findUnique({
          where: { id: waypoint.appointmentId },
          include: {
            customer: true,
            lead: true,
          },
        });

        if (!appointment) {
          return createErrorResponse(404, 'Appointment not found', {
            appointmentId: waypoint.appointmentId,
          });
        }

        // Use geocoded coordinates if available
        if (appointment.customer?.latitude && appointment.customer?.longitude) {
          resolvedWaypoints.push({
            lat: appointment.customer.latitude,
            lng: appointment.customer.longitude,
          });
        } else if (appointment.lead?.latitude && appointment.lead?.longitude) {
          resolvedWaypoints.push({
            lat: appointment.lead.latitude,
            lng: appointment.lead.longitude,
          });
        } else {
          // Use address
          const address = appointment.locatie || 
            (appointment.customer ? 
              `${appointment.customer.address}, ${appointment.customer.postalCode} ${appointment.customer.city}` :
              appointment.lead ?
              `${appointment.lead.adres}, ${appointment.lead.postcode} ${appointment.lead.stad}` :
              null);
          
          if (!address) {
            return createErrorResponse(400, 'No address found for appointment', {
              appointmentId: waypoint.appointmentId,
            });
          }

          resolvedWaypoints.push(address);
        }

        appointmentMap.set(i, waypoint.appointmentId);
      } else if ('address' in waypoint) {
        resolvedWaypoints.push(waypoint.address);
      } else {
        resolvedWaypoints.push(waypoint as LatLng);
      }
    }

    // Resolve origin and destination
    const resolveLocation = async (location: any): Promise<LatLng | string> => {
      if ('appointmentId' in location) {
        const appointment = await prisma.afspraak.findUnique({
          where: { id: location.appointmentId },
          include: { customer: true, lead: true },
        });
        
        if (!appointment) {
          throw new Error(`Appointment ${location.appointmentId} not found`);
        }

        if (appointment.customer?.latitude && appointment.customer?.longitude) {
          return {
            lat: appointment.customer.latitude,
            lng: appointment.customer.longitude,
          };
        }
        
        const address = appointment.locatie || 
          (appointment.customer ? 
            `${appointment.customer.address}, ${appointment.customer.postalCode} ${appointment.customer.city}` :
            `${appointment.lead!.adres}, ${appointment.lead!.postcode} ${appointment.lead!.stad}`);
        
        return address;
      } else if ('address' in location) {
        return location.address;
      } else {
        return location as LatLng;
      }
    };

    const origin = await resolveLocation(validatedData.origin);
    const destination = validatedData.destination 
      ? await resolveLocation(validatedData.destination)
      : origin; // Round trip if no destination specified

    // Optimize the route
    const optimizedRoute = await googleMaps.optimizeRoute(
      origin,
      resolvedWaypoints,
      destination,
      validatedData.travelMode
    );

    // Calculate total distance and duration
    const primaryRoute = optimizedRoute.routes[0];
    const totalDistance = primaryRoute.legs.reduce((sum, leg) => sum + leg.distance.value, 0);
    const totalDuration = primaryRoute.legs.reduce((sum, leg) => sum + leg.duration.value, 0);

    // Map optimized order back to appointment IDs
    const optimizedAppointments = optimizedRoute.optimizedOrder.map(index => {
      const appointmentId = appointmentMap.get(index);
      return {
        index,
        appointmentId,
        originalIndex: index,
      };
    });

    // Update route cluster if provided
    if (validatedData.routeClusterId) {
      await prisma.routeCluster.update({
        where: { id: validatedData.routeClusterId },
        data: {
          optimizedOrder: optimizedAppointments.map(a => a.appointmentId).filter(Boolean) as string[],
          totalDistance: totalDistance,
          totalDuration: Math.round(totalDuration / 60), // Convert to minutes
          routePolyline: primaryRoute.overviewPolyline,
          travelMode: validatedData.travelMode,
          optimizedAt: new Date(),
        },
      });
    }

    // Get performance metrics
    const metrics = googleMaps.getPerformanceMetrics();

    // Format response
    const response = {
      success: true,
      route: {
        optimizedOrder: optimizedRoute.optimizedOrder,
        optimizedAppointments,
        totalDistance: {
          meters: totalDistance,
          text: `${(totalDistance / 1000).toFixed(1)} km`,
        },
        totalDuration: {
          seconds: totalDuration,
          text: formatDuration(totalDuration),
        },
        bounds: primaryRoute.bounds,
        polyline: primaryRoute.overviewPolyline,
        waypoints: resolvedWaypoints.length,
        travelMode: validatedData.travelMode,
      },
      performance: {
        optimizationTime: metrics.recent[metrics.recent.length - 1]?.latency,
        cacheHitRate: metrics.summary.cacheHitRate,
        estimatedSavings: calculateTimeSavings(
          optimizedRoute.optimizedOrder,
          resolvedWaypoints.length
        ),
      },
    };

    return createResponse(200, response);

  } catch (error) {
    console.error('Route optimization error:', error);

    // Handle validation errors
    if (error instanceof ZodError) {
      return createErrorResponse(400, 'Validation error', {
        details: error.issues,
      });
    }

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while optimizing the route',
    });
  } finally {
    // Ensure database connection is closed
    await prisma.$disconnect();
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

// Calculate estimated time savings from optimization
function calculateTimeSavings(optimizedOrder: number[], totalWaypoints: number): string {
  // Rough estimate: optimization saves ~15-25% of travel time on average
  const savingsPercentage = 0.2;
  const baseTimePerWaypoint = 30; // minutes
  const estimatedSavings = Math.round(totalWaypoints * baseTimePerWaypoint * savingsPercentage);
  
  return `~${estimatedSavings} minuten bespaard`;
}