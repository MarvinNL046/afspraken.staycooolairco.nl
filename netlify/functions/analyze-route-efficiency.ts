import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z, ZodError } from 'zod';
import { routeOptimizer } from '../../lib/route-optimizer';
import { TravelMode, LatLng } from '../../types/google-maps';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import { format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const prisma = new PrismaClient();

// Validation schema
const analyzeRouteSchema = z.object({
  routeClusterId: z.string().cuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  travelMode: z.nativeEnum(TravelMode).default(TravelMode.DRIVING),
  includeRecommendations: z.boolean().default(true),
  apiKey: z.string().min(1, 'API key is required'),
});

interface RouteAnalysis {
  clusterId?: string;
  date: string;
  metrics: {
    appointments: number;
    totalDistance: number; // meters
    totalDuration: number; // minutes
    workingTime: number; // minutes
    efficiency: number; // percentage
    utilizationRate: number; // percentage
    averageDistanceBetweenStops: number; // meters
    longestLeg: {
      distance: number;
      duration: number;
      from: string;
      to: string;
    };
  };
  timeline: Array<{
    time: string;
    activity: string;
    duration: number;
    location?: string;
  }>;
  costs: {
    fuel: number; // euros
    time: number; // euros
    total: number; // euros
  };
  recommendations?: string[];
  alternativeRoutes?: Array<{
    strategy: string;
    improvement: string;
    savingsPercentage: number;
  }>;
}

/**
 * Route Efficiency Analysis Function
 * Endpoint: /.netlify/functions/analyze-route-efficiency
 * Method: POST
 * 
 * Analyzes route efficiency and provides optimization recommendations
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
    const validatedData = analyzeRouteSchema.parse(body);

    // Verify API key
    const adminApiKey = process.env.ADMIN_API_KEY || 'your-admin-api-key';
    if (validatedData.apiKey !== adminApiKey) {
      return createErrorResponse(401, 'Invalid API key');
    }

    // Get route cluster(s) to analyze
    const routeClusters = await getRouteClusters(
      validatedData.routeClusterId,
      validatedData.date
    );

    if (routeClusters.length === 0) {
      return createErrorResponse(404, 'No route clusters found for analysis');
    }

    // Analyze each route cluster
    const analyses: RouteAnalysis[] = [];
    
    for (const cluster of routeClusters) {
      const analysis = await analyzeRouteCluster(
        cluster,
        validatedData.travelMode,
        validatedData.includeRecommendations
      );
      analyses.push(analysis);
    }

    // Calculate aggregate metrics if multiple routes
    const aggregateMetrics = calculateAggregateMetrics(analyses);

    return createResponse(200, {
      success: true,
      analyses,
      aggregate: analyses.length > 1 ? aggregateMetrics : undefined,
      configuration: {
        travelMode: validatedData.travelMode,
        includeRecommendations: validatedData.includeRecommendations,
        analyzedRoutes: analyses.length,
      },
    });

  } catch (error) {
    console.error('Route analysis error:', error);

    if (error instanceof ZodError) {
      return createErrorResponse(400, 'Validation error', {
        details: error.issues,
      });
    }

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while analyzing route efficiency',
    });
  } finally {
    await prisma.$disconnect();
  }
};

async function getRouteClusters(
  clusterId?: string,
  date?: string
) {
  const where: any = {};

  if (clusterId) {
    where.id = clusterId;
  }

  if (date) {
    const parsedDate = parseISO(date);
    where.datum = {
      gte: startOfDay(parsedDate),
      lte: endOfDay(parsedDate),
    };
  }

  return await prisma.routeCluster.findMany({
    where,
    include: {
      afspraken: {
        include: {
          customer: true,
          lead: true,
        },
      },
    },
    orderBy: {
      datum: 'asc',
    },
  });
}

async function analyzeRouteCluster(
  cluster: any,
  travelMode: TravelMode,
  includeRecommendations: boolean
): Promise<RouteAnalysis> {
  // Extract appointment locations
  const appointments = cluster.afspraken.map((apt: any) => {
    const hasCustomer = apt.customer && apt.customer.latitude && apt.customer.longitude;
    return {
      id: apt.id,
      time: apt.tijd,
      duration: 60, // 1 hour appointments
      location: hasCustomer ? {
        lat: apt.customer.latitude,
        lng: apt.customer.longitude,
        address: `${apt.customer.address}, ${apt.customer.postalCode} ${apt.customer.city}`,
      } : {
        lat: apt.lead.latitude,
        lng: apt.lead.longitude,
        address: `${apt.lead.adres}, ${apt.lead.postcode} ${apt.lead.stad}`,
      },
    };
  });

  // Default center point (can be customized)
  const centerPoint: LatLng = { lat: 52.3676, lng: 4.9041 };

  // Get optimized order from cluster or recalculate
  let orderedAppointments = appointments;
  if (cluster.optimizedOrder && Array.isArray(cluster.optimizedOrder)) {
    // Reorder based on stored optimization
    const orderMap = new Map<string, number>(
      cluster.optimizedOrder.map((id: string, index: number) => [id, index] as [string, number])
    );
    orderedAppointments = appointments.sort((a: any, b: any) => {
      const aOrder: number = orderMap.get(a.id) ?? 999;
      const bOrder: number = orderMap.get(b.id) ?? 999;
      return aOrder - bOrder;
    });
  }

  // Build timeline and calculate metrics
  const timeline = buildDetailedTimeline(orderedAppointments, centerPoint);
  const metrics = calculateRouteMetrics(
    orderedAppointments,
    centerPoint,
    cluster.totalDistance || 0,
    cluster.totalDuration || 0
  );

  // Calculate costs
  const costs = calculateRouteCosts(metrics, travelMode);

  // Generate recommendations if requested
  let recommendations: string[] = [];
  let alternativeRoutes: any[] = [];

  if (includeRecommendations) {
    recommendations = generateRecommendations(metrics, orderedAppointments);
    alternativeRoutes = await generateAlternativeRoutes(
      orderedAppointments,
      centerPoint,
      travelMode,
      metrics
    );
  }

  return {
    clusterId: cluster.id,
    date: format(cluster.datum, 'yyyy-MM-dd'),
    metrics,
    timeline,
    costs,
    recommendations: includeRecommendations ? recommendations : undefined,
    alternativeRoutes: includeRecommendations ? alternativeRoutes : undefined,
  };
}

function buildDetailedTimeline(
  appointments: any[],
  centerPoint: LatLng
): RouteAnalysis['timeline'] {
  const timeline: RouteAnalysis['timeline'] = [];
  let currentTime = '09:30';

  // Start from center
  timeline.push({
    time: currentTime,
    activity: 'Vertrek vanaf basis',
    duration: 0,
    location: 'Centraal punt',
  });

  // Add travel to first appointment
  if (appointments.length > 0) {
    const travelTime = estimateTravelTime(
      centerPoint,
      appointments[0].location,
      TravelMode.DRIVING
    );
    
    currentTime = addMinutesToTime(currentTime, travelTime);
    timeline.push({
      time: currentTime,
      activity: 'Reistijd naar eerste afspraak',
      duration: travelTime,
    });
  }

  // Process each appointment
  for (let i = 0; i < appointments.length; i++) {
    const apt = appointments[i];
    
    // Appointment
    timeline.push({
      time: currentTime,
      activity: `Afspraak ${i + 1}`,
      duration: apt.duration,
      location: apt.location.address,
    });
    
    currentTime = addMinutesToTime(currentTime, apt.duration);

    // Travel to next appointment or back to center
    if (i < appointments.length - 1) {
      const travelTime = estimateTravelTime(
        apt.location,
        appointments[i + 1].location,
        TravelMode.DRIVING
      );
      
      timeline.push({
        time: currentTime,
        activity: `Reistijd naar afspraak ${i + 2}`,
        duration: travelTime,
      });
      
      currentTime = addMinutesToTime(currentTime, travelTime + 15); // 15 min buffer
    } else {
      // Return to center
      const travelTime = estimateTravelTime(
        apt.location,
        centerPoint,
        TravelMode.DRIVING
      );
      
      timeline.push({
        time: currentTime,
        activity: 'Terugkeer naar basis',
        duration: travelTime,
      });
      
      currentTime = addMinutesToTime(currentTime, travelTime);
    }
  }

  // End time
  timeline.push({
    time: currentTime,
    activity: 'Einde werkdag',
    duration: 0,
  });

  return timeline;
}

function calculateRouteMetrics(
  appointments: any[],
  centerPoint: LatLng,
  totalDistance: number,
  totalDuration: number
): RouteAnalysis['metrics'] {
  // Calculate working time
  const appointmentTime = appointments.length * 60; // 1 hour each
  const workingTime = appointmentTime + totalDuration + (appointments.length - 1) * 15; // buffers

  // Calculate efficiency
  const availableMinutes = 390; // 6.5 hours = 390 minutes
  const utilizationRate = Math.min((workingTime / availableMinutes) * 100, 100);
  const efficiency = appointments.length > 0 ? 
    (appointmentTime / workingTime) * 100 : 0;

  // Find longest leg
  let longestLeg = {
    distance: 0,
    duration: 0,
    from: 'Basis',
    to: 'Basis',
  };

  if (appointments.length > 0) {
    // Check first leg
    const firstDist = calculateDistance(centerPoint, appointments[0].location);
    if (firstDist > longestLeg.distance) {
      longestLeg = {
        distance: firstDist * 1000,
        duration: estimateTravelTime(centerPoint, appointments[0].location, TravelMode.DRIVING),
        from: 'Basis',
        to: appointments[0].location.address,
      };
    }

    // Check intermediate legs
    for (let i = 0; i < appointments.length - 1; i++) {
      const dist = calculateDistance(
        appointments[i].location,
        appointments[i + 1].location
      );
      if (dist * 1000 > longestLeg.distance) {
        longestLeg = {
          distance: dist * 1000,
          duration: estimateTravelTime(
            appointments[i].location,
            appointments[i + 1].location,
            TravelMode.DRIVING
          ),
          from: appointments[i].location.address,
          to: appointments[i + 1].location.address,
        };
      }
    }

    // Check last leg
    const lastDist = calculateDistance(
      appointments[appointments.length - 1].location,
      centerPoint
    );
    if (lastDist * 1000 > longestLeg.distance) {
      longestLeg = {
        distance: lastDist * 1000,
        duration: estimateTravelTime(
          appointments[appointments.length - 1].location,
          centerPoint,
          TravelMode.DRIVING
        ),
        from: appointments[appointments.length - 1].location.address,
        to: 'Basis',
      };
    }
  }

  return {
    appointments: appointments.length,
    totalDistance: totalDistance || 0,
    totalDuration: totalDuration || 0,
    workingTime,
    efficiency: Math.round(efficiency),
    utilizationRate: Math.round(utilizationRate),
    averageDistanceBetweenStops: appointments.length > 0 ? 
      Math.round(totalDistance / (appointments.length + 1)) : 0,
    longestLeg,
  };
}

function calculateRouteCosts(
  metrics: RouteAnalysis['metrics'],
  travelMode: TravelMode
): RouteAnalysis['costs'] {
  // Cost factors
  const fuelCostPerKm = travelMode === TravelMode.DRIVING ? 0.20 : 0; // €0.20/km
  const hourlyRate = 45; // €45/hour technician cost

  const fuelCost = (metrics.totalDistance / 1000) * fuelCostPerKm;
  const timeCost = (metrics.workingTime / 60) * hourlyRate;

  return {
    fuel: Math.round(fuelCost * 100) / 100,
    time: Math.round(timeCost * 100) / 100,
    total: Math.round((fuelCost + timeCost) * 100) / 100,
  };
}

function generateRecommendations(
  metrics: RouteAnalysis['metrics'],
  appointments: any[]
): string[] {
  const recommendations: string[] = [];

  // Efficiency recommendations
  if (metrics.efficiency < 60) {
    recommendations.push(
      'Route-efficiëntie is laag (<60%). Overweeg afspraken geografisch te clusteren.'
    );
  }

  // Utilization recommendations
  if (metrics.utilizationRate < 70 && appointments.length < 5) {
    recommendations.push(
      'Dagbezetting is laag. Er is ruimte voor 1-2 extra afspraken.'
    );
  } else if (metrics.utilizationRate > 95) {
    recommendations.push(
      'Dagplanning is erg vol. Overweeg buffer tijd voor onverwachte vertragingen.'
    );
  }

  // Distance recommendations
  if (metrics.averageDistanceBetweenStops > 15000) {
    recommendations.push(
      'Gemiddelde afstand tussen stops is hoog (>15km). Probeer afspraken dichter bij elkaar te plannen.'
    );
  }

  // Long leg recommendations
  if (metrics.longestLeg.distance > 25000) {
    recommendations.push(
      `Langste route segment is ${Math.round(metrics.longestLeg.distance / 1000)}km. ` +
      `Overweeg tussenstop of herplanning.`
    );
  }

  // Appointment count
  if (appointments.length < 3) {
    recommendations.push(
      'Weinig afspraken gepland. Combineer met andere dagen voor efficiëntere routes.'
    );
  }

  return recommendations;
}

async function generateAlternativeRoutes(
  appointments: any[],
  centerPoint: LatLng,
  travelMode: TravelMode,
  currentMetrics: RouteAnalysis['metrics']
): Promise<any[]> {
  const alternatives: any[] = [];

  // Geographic clustering alternative
  if (appointments.length >= 3) {
    const clustered = clusterByGeography(appointments);
    const clusterSavings = estimateSavings(clustered, appointments, currentMetrics);
    
    if (clusterSavings > 10) {
      alternatives.push({
        strategy: 'Geografische clustering',
        improvement: 'Groepeer afspraken per wijk/gebied',
        savingsPercentage: Math.round(clusterSavings),
      });
    }
  }

  // Different travel mode
  if (travelMode === TravelMode.DRIVING && currentMetrics.totalDistance < 30000) {
    alternatives.push({
      strategy: 'Fietsroute',
      improvement: 'Voor korte afstanden kan fietsen efficiënter zijn',
      savingsPercentage: 15, // Estimated
    });
  }

  // Time window optimization
  if (currentMetrics.efficiency < 70) {
    alternatives.push({
      strategy: 'Tijdvenster optimalisatie',
      improvement: 'Begin eerder (9:00) of werk door tot 16:30',
      savingsPercentage: Math.round((80 - currentMetrics.efficiency) / 2),
    });
  }

  return alternatives;
}

function clusterByGeography(appointments: any[]): any[] {
  // Simple k-means style clustering
  // This is a simplified version - real implementation would use proper clustering
  return appointments.sort((a, b) => {
    const distA = calculateDistance({ lat: 52.3676, lng: 4.9041 }, a.location);
    const distB = calculateDistance({ lat: 52.3676, lng: 4.9041 }, b.location);
    return distA - distB;
  });
}

function estimateSavings(
  optimized: any[],
  original: any[],
  metrics: RouteAnalysis['metrics']
): number {
  // Simplified savings estimation
  const originalDistance = metrics.totalDistance;
  const optimizedDistance = originalDistance * 0.8; // Assume 20% improvement
  return ((originalDistance - optimizedDistance) / originalDistance) * 100;
}

function calculateAggregateMetrics(analyses: RouteAnalysis[]) {
  const total = analyses.reduce((acc, analysis) => ({
    appointments: acc.appointments + analysis.metrics.appointments,
    distance: acc.distance + analysis.metrics.totalDistance,
    duration: acc.duration + analysis.metrics.totalDuration,
    workingTime: acc.workingTime + analysis.metrics.workingTime,
    fuelCost: acc.fuelCost + analysis.costs.fuel,
    totalCost: acc.totalCost + analysis.costs.total,
  }), {
    appointments: 0,
    distance: 0,
    duration: 0,
    workingTime: 0,
    fuelCost: 0,
    totalCost: 0,
  });

  const avgEfficiency = analyses.reduce((sum, a) => sum + a.metrics.efficiency, 0) / analyses.length;
  const avgUtilization = analyses.reduce((sum, a) => sum + a.metrics.utilizationRate, 0) / analyses.length;

  return {
    totalRoutes: analyses.length,
    totalAppointments: total.appointments,
    totalDistance: total.distance,
    totalDuration: total.duration,
    totalWorkingTime: total.workingTime,
    averageEfficiency: Math.round(avgEfficiency),
    averageUtilization: Math.round(avgUtilization),
    totalCosts: {
      fuel: Math.round(total.fuelCost * 100) / 100,
      total: Math.round(total.totalCost * 100) / 100,
    },
  };
}

// Helper functions
function calculateDistance(point1: LatLng, point2: LatLng): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(point2.lat - point1.lat);
  const dLng = toRadians(point2.lng - point1.lng);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(point1.lat)) * Math.cos(toRadians(point2.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function estimateTravelTime(
  origin: LatLng,
  destination: LatLng,
  travelMode: TravelMode
): number {
  const distance = calculateDistance(origin, destination);
  const speeds: Record<TravelMode, number> = {
    [TravelMode.DRIVING]: 40,
    [TravelMode.BICYCLING]: 18,
    [TravelMode.WALKING]: 5,
    [TravelMode.TRANSIT]: 30,
    [TravelMode.TWO_WHEELER]: 25,
  };
  
  const speed = speeds[travelMode] || speeds[TravelMode.DRIVING];
  return Math.ceil((distance / speed) * 60);
}

function addMinutesToTime(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number);
  const totalMinutes = hours * 60 + mins + minutes;
  const newHours = Math.floor(totalMinutes / 60);
  const newMins = totalMinutes % 60;
  return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')}`;
}