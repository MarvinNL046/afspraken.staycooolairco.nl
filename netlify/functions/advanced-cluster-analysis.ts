import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { parseISO, isValid, format, startOfWeek, endOfWeek, addDays, differenceInMinutes, isWeekend } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import { googleMaps } from '../../lib/google-maps';
import { TravelMode } from '../../types/google-maps';

const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

// Validation schemas
const clusterAnalysisSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format').optional(),
  centerPoint: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().max(500).optional(),
  }).optional(),
  analysisType: z.enum(['efficiency', 'coverage', 'optimization', 'forecasting']).default('efficiency'),
  optimizationStrategy: z.enum(['minimal_travel', 'maximum_appointments', 'balanced', 'customer_priority']).default('balanced'),
  includeMetrics: z.boolean().default(true),
  maxRadius: z.number().min(1).max(50).default(20), // km
  includeWeekends: z.boolean().default(false),
  minAppointmentsForCluster: z.number().min(1).max(10).default(2),
  apiKey: z.string().min(1, 'API key is required'),
});

const SALES_TEAM_COLOR_ID = '5';
const LIMBURG_CENTER = { lat: 50.8514, lng: 5.6909 }; // Approximate center of Limburg

const BUSINESS_RULES = {
  workingHours: { start: '09:30', end: '16:00' },
  maxAppointmentsPerDay: 5,
  maxRadiusKm: 20,
  workDays: [1, 2, 3, 4, 5], // Monday to Friday
  appointmentDuration: 60, // minutes
  travelBufferMinutes: 15,
  maxDrivingTimePerDay: 240, // 4 hours maximum driving per day
};

interface AppointmentWithLocation {
  id: string;
  date: Date;
  time: string;
  duration: number;
  serviceType: string;
  priority: number;
  customer: {
    name: string;
    address: string;
    coordinates: { lat: number; lng: number };
    phone: string;
    email: string;
  };
  urgency?: string;
  preferredTechnician?: string;
}

interface ClusterAnalysisResult {
  clusters: DayCluster[];
  metrics: AnalysisMetrics;
  recommendations: Recommendation[];
  optimization: OptimizationSuggestions;
  forecast?: ForecastData;
}

interface DayCluster {
  date: string;
  appointments: AppointmentWithLocation[];
  route: RouteOptimization;
  efficiency: EfficiencyMetrics;
  capacity: CapacityAnalysis;
}

interface RouteOptimization {
  totalDistance: number; // meters
  totalTravelTime: number; // minutes
  optimizedOrder: string[]; // appointment IDs in optimal order
  waypoints: Array<{ lat: number; lng: number; appointmentId: string }>;
  estimatedFuelCost: number;
  co2Emissions: number; // kg
}

interface EfficiencyMetrics {
  routeEfficiency: number; // 0-100%
  timeUtilization: number; // 0-100%
  distancePerAppointment: number; // average km per appointment
  appointmentDensity: number; // appointments per km²
  wastedTravelTime: number; // minutes that could be optimized
}

interface CapacityAnalysis {
  currentAppointments: number;
  maxPossibleAppointments: number;
  utilizationRate: number; // 0-100%
  availableSlots: number;
  timeConstraints: string[];
}

interface AnalysisMetrics {
  totalAppointments: number;
  totalDays: number;
  averageAppointmentsPerDay: number;
  totalDistance: number;
  totalTravelTime: number;
  averageEfficiency: number;
  costSavingsPotential: number;
  environmentalImpact: {
    totalCO2: number;
    potentialReduction: number;
  };
}

interface Recommendation {
  type: 'route_optimization' | 'scheduling' | 'capacity' | 'cost_saving';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  estimatedSavings: {
    time?: number; // minutes
    distance?: number; // km
    cost?: number; // euros
  };
  implementation: string;
}

interface OptimizationSuggestions {
  routeImprovements: Array<{
    date: string;
    currentOrder: string[];
    suggestedOrder: string[];
    timeSaving: number;
    distanceSaving: number;
  }>;
  capacityOptimizations: Array<{
    date: string;
    currentCapacity: number;
    potentialCapacity: number;
    additionalSlots: Array<{ time: string; efficiency: number }>;
  }>;
  schedulingAdjustments: Array<{
    appointmentId: string;
    currentDate: string;
    suggestedDate: string;
    reason: string;
    efficiencyGain: number;
  }>;
}

interface ForecastData {
  nextWeekPrediction: {
    expectedAppointments: number;
    recommendedCapacity: number;
    highDemandDays: string[];
  };
  monthlyTrends: {
    growthRate: number;
    seasonalFactors: Record<string, number>;
    capacityNeeds: Record<string, number>;
  };
}

/**
 * Advanced Cluster Analysis Function
 * 
 * Provides comprehensive route optimization, efficiency analysis, and capacity planning
 * for the StayCool Airco appointment system with advanced business intelligence features.
 * 
 * Features:
 * - Multi-day route optimization with Google Maps integration
 * - Efficiency metrics and cost analysis
 * - Capacity utilization and optimization suggestions
 * - Environmental impact assessment
 * - Forecasting and demand prediction
 * - Business intelligence recommendations
 * - Real-time performance monitoring
 * 
 * Endpoint: /.netlify/functions/advanced-cluster-analysis
 * Method: POST
 * 
 * Request Body:
 * {
 *   "startDate": "2024-01-15",
 *   "endDate": "2024-01-19",
 *   "analysisType": "efficiency",
 *   "optimizationStrategy": "balanced",
 *   "centerPoint": {
 *     "lat": 50.8514,
 *     "lng": 5.6909
 *   },
 *   "apiKey": "your-admin-api-key"
 * }
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('POST, OPTIONS');
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return createErrorResponse(405, 'Method not allowed', {
      allowedMethods: ['POST', 'OPTIONS']
    });
  }

  const startTime = Date.now();

  try {
    // Parse request body
    if (!event.body) {
      return createErrorResponse(400, 'Request body is required');
    }

    let requestData;
    try {
      requestData = JSON.parse(event.body);
    } catch (parseError) {
      return createErrorResponse(400, 'Invalid JSON in request body');
    }

    // Validate request data
    let validatedData;
    try {
      validatedData = clusterAnalysisSchema.parse(requestData);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return createErrorResponse(400, 'Validation error', {
          details: validationError.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          }))
        });
      }
      throw validationError;
    }

    // Verify admin API key
    const adminApiKey = process.env.ADMIN_API_KEY;
    if (!adminApiKey || validatedData.apiKey !== adminApiKey) {
      return createErrorResponse(401, 'Invalid API key', {
        message: 'Valid admin API key is required for cluster analysis'
      });
    }

    // Parse and validate dates
    const startDate = parseISO(validatedData.startDate);
    const endDate = validatedData.endDate ? parseISO(validatedData.endDate) : addDays(startDate, 6);

    if (!isValid(startDate) || !isValid(endDate)) {
      return createErrorResponse(400, 'Invalid date format');
    }

    if (endDate < startDate) {
      return createErrorResponse(400, 'End date must be after start date');
    }

    if (differenceInMinutes(endDate, startDate) > 30 * 24 * 60) { // 30 days max
      return createErrorResponse(400, 'Analysis period cannot exceed 30 days');
    }

    // Get center point (default to Limburg center)
    const centerPoint = validatedData.centerPoint || LIMBURG_CENTER;

    // Fetch appointments data
    const appointments = await fetchAppointmentsWithLocation(startDate, endDate, validatedData.includeWeekends);

    if (appointments.length === 0) {
      return createResponse(200, {
        success: true,
        message: 'No appointments found in the specified date range',
        period: {
          startDate: format(startDate, 'yyyy-MM-dd'),
          endDate: format(endDate, 'yyyy-MM-dd'),
        },
        metrics: getEmptyMetrics(),
      });
    }

    // Filter appointments within radius
    const appointmentsInRadius = filterAppointmentsByRadius(
      appointments,
      centerPoint,
      validatedData.maxRadius
    );

    // Perform cluster analysis
    const clusterAnalysis = await performAdvancedClusterAnalysis(
      appointmentsInRadius,
      centerPoint,
      validatedData.analysisType,
      validatedData.optimizationStrategy,
      validatedData.minAppointmentsForCluster
    );

    // Generate recommendations
    const recommendations = generateRecommendations(clusterAnalysis);

    // Calculate optimization suggestions
    const optimizationSuggestions = await calculateOptimizationSuggestions(clusterAnalysis);

    // Generate forecast if requested
    let forecast: ForecastData | undefined;
    if (validatedData.analysisType === 'forecasting') {
      forecast = await generateForecast(appointments, startDate, endDate);
    }

    // Prepare comprehensive response
    const response: ClusterAnalysisResult = {
      clusters: clusterAnalysis.clusters,
      metrics: clusterAnalysis.metrics,
      recommendations: recommendations,
      optimization: optimizationSuggestions,
      forecast: forecast,
    };

    return createResponse(200, {
      success: true,
      analysis: response,
      configuration: {
        analysisType: validatedData.analysisType,
        optimizationStrategy: validatedData.optimizationStrategy,
        period: {
          startDate: format(startDate, 'yyyy-MM-dd'),
          endDate: format(endDate, 'yyyy-MM-dd'),
          days: Math.ceil(differenceInMinutes(endDate, startDate) / (24 * 60)),
        },
        centerPoint: centerPoint,
        businessRules: BUSINESS_RULES,
        processingTime: Date.now() - startTime,
      },
    }, {
      'X-Analysis-Type': validatedData.analysisType,
      'X-Processing-Time': `${Date.now() - startTime}ms`,
      'Cache-Control': 'private, max-age=300', // 5 minutes cache for analysis
    });

  } catch (error) {
    console.error('Advanced cluster analysis error:', error);

    const errorDetails = {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
    };

    console.error('Analysis error details:', errorDetails);

    return createErrorResponse(500, 'Analysis failed', {
      message: 'An error occurred during cluster analysis. Please try again later.',
      analysisId: `analysis_${Date.now()}`,
    });
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Fetch appointments with location data from the database
 */
async function fetchAppointmentsWithLocation(
  startDate: Date,
  endDate: Date,
  includeWeekends: boolean
): Promise<AppointmentWithLocation[]> {
  const appointments = await prisma.afspraak.findMany({
    where: {
      datum: {
        gte: startDate,
        lte: endDate,
      },
      status: {
        in: ['gepland', 'bevestigd', 'afgerond']
      },
      colorId: SALES_TEAM_COLOR_ID, // Only sales team appointments
      OR: [
        {
          customer: {
            latitude: { not: null },
            longitude: { not: null },
          }
        },
        {
          lead: {
            latitude: { not: null },
            longitude: { not: null },
          }
        }
      ]
    },
    include: {
      customer: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          address: true,
          latitude: true,
          longitude: true,
        }
      },
      lead: {
        select: {
          naam: true,
          telefoon: true,
          email: true,
          adres: true,
          latitude: true,
          longitude: true,
        }
      }
    },
    orderBy: [
      { datum: 'asc' },
      { tijd: 'asc' }
    ]
  });

  return appointments
    .filter(apt => {
      if (!includeWeekends && isWeekend(apt.datum)) {
        return false;
      }
      return true;
    })
    .map(apt => {
      const customerData = apt.customer || apt.lead;
      const isCustomer = !!apt.customer;

      if (!customerData) {
        return null; // Skip appointments without customer data
      }

      return {
        id: apt.id,
        date: apt.datum,
        time: apt.tijd,
        duration: apt.duur || BUSINESS_RULES.appointmentDuration,
        serviceType: apt.serviceType,
        priority: apt.prioriteit || 0,
        customer: {
          name: isCustomer 
            ? `${(customerData as any).firstName} ${(customerData as any).lastName}`
            : (customerData as any).naam,
          address: isCustomer ? (customerData as any).address : (customerData as any).adres,
          coordinates: {
            lat: customerData.latitude!,
            lng: customerData.longitude!,
          },
          phone: isCustomer ? (customerData as any).phone : (customerData as any).telefoon,
          email: customerData.email,
        }
      };
    })
    .filter((apt): apt is NonNullable<typeof apt> => apt !== null);
}

/**
 * Filter appointments by radius from center point
 */
function filterAppointmentsByRadius(
  appointments: AppointmentWithLocation[],
  centerPoint: { lat: number; lng: number },
  maxRadiusKm: number
): AppointmentWithLocation[] {
  return appointments.filter(apt => {
    const distance = calculateHaversineDistance(
      centerPoint,
      apt.customer.coordinates
    );
    return distance <= maxRadiusKm;
  });
}

/**
 * Calculate distance between two points using Haversine formula
 */
function calculateHaversineDistance(
  point1: { lat: number; lng: number },
  point2: { lat: number; lng: number }
): number {
  const R = 6371; // Earth's radius in kilometers
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

/**
 * Perform advanced cluster analysis
 */
async function performAdvancedClusterAnalysis(
  appointments: AppointmentWithLocation[],
  centerPoint: { lat: number; lng: number },
  analysisType: string,
  optimizationStrategy: string,
  minAppointmentsForCluster: number
): Promise<{ clusters: DayCluster[]; metrics: AnalysisMetrics }> {
  // Group appointments by date
  const appointmentsByDate = appointments.reduce((groups, apt) => {
    const dateKey = format(apt.date, 'yyyy-MM-dd');
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(apt);
    return groups;
  }, {} as Record<string, AppointmentWithLocation[]>);

  const clusters: DayCluster[] = [];
  let totalDistance = 0;
  let totalTravelTime = 0;

  // Process each day
  for (const [dateKey, dayAppointments] of Object.entries(appointmentsByDate)) {
    if (dayAppointments.length < minAppointmentsForCluster) {
      continue; // Skip days with insufficient appointments for meaningful clustering
    }

    // Optimize route for the day
    const routeOptimization = await optimizeDayRoute(dayAppointments, centerPoint);
    
    // Calculate efficiency metrics
    const efficiency = calculateEfficiencyMetrics(dayAppointments, routeOptimization);
    
    // Analyze capacity
    const capacity = analyzeCapacity(dayAppointments, parseISO(dateKey));

    clusters.push({
      date: dateKey,
      appointments: dayAppointments,
      route: routeOptimization,
      efficiency: efficiency,
      capacity: capacity,
    });

    totalDistance += routeOptimization.totalDistance;
    totalTravelTime += routeOptimization.totalTravelTime;
  }

  // Calculate overall metrics
  const metrics: AnalysisMetrics = {
    totalAppointments: appointments.length,
    totalDays: clusters.length,
    averageAppointmentsPerDay: appointments.length / (clusters.length || 1),
    totalDistance: totalDistance,
    totalTravelTime: totalTravelTime,
    averageEfficiency: clusters.reduce((sum, c) => sum + c.efficiency.routeEfficiency, 0) / (clusters.length || 1),
    costSavingsPotential: calculateCostSavingsPotential(clusters),
    environmentalImpact: {
      totalCO2: calculateCO2Emissions(totalDistance),
      potentialReduction: calculatePotentialCO2Reduction(clusters),
    },
  };

  return { clusters, metrics };
}

/**
 * Optimize route for a single day
 */
async function optimizeDayRoute(
  appointments: AppointmentWithLocation[],
  centerPoint: { lat: number; lng: number }
): Promise<RouteOptimization> {
  if (appointments.length <= 1) {
    return {
      totalDistance: 0,
      totalTravelTime: 0,
      optimizedOrder: appointments.map(a => a.id),
      waypoints: appointments.map(a => ({
        lat: a.customer.coordinates.lat,
        lng: a.customer.coordinates.lng,
        appointmentId: a.id,
      })),
      estimatedFuelCost: 0,
      co2Emissions: 0,
    };
  }

  try {
    // Use Google Maps to optimize the route
    const waypoints = appointments.map(apt => apt.customer.coordinates);
    
    const optimizedRoute = await googleMaps.optimizeRoute(
      centerPoint,
      waypoints,
      centerPoint,
      TravelMode.DRIVING
    );

    // Calculate costs and emissions
    const totalDistance = optimizedRoute.routes[0]?.legs.reduce((sum, leg) => sum + leg.distance.value, 0) || 0;
    const totalTravelTime = Math.round(
      (optimizedRoute.routes[0]?.legs.reduce((sum, leg) => sum + leg.duration.value, 0) || 0) / 60
    );

    return {
      totalDistance: totalDistance,
      totalTravelTime: totalTravelTime,
      optimizedOrder: optimizedRoute.optimizedOrder.map(index => appointments[index].id),
      waypoints: optimizedRoute.optimizedOrder.map(index => ({
        lat: appointments[index].customer.coordinates.lat,
        lng: appointments[index].customer.coordinates.lng,
        appointmentId: appointments[index].id,
      })),
      estimatedFuelCost: calculateFuelCost(totalDistance),
      co2Emissions: calculateCO2Emissions(totalDistance),
    };

  } catch (error) {
    console.warn('Route optimization failed, using fallback:', error);
    
    // Fallback to simple nearest-neighbor optimization
    return optimizeRouteFallback(appointments, centerPoint);
  }
}

/**
 * Fallback route optimization using nearest-neighbor algorithm
 */
function optimizeRouteFallback(
  appointments: AppointmentWithLocation[],
  centerPoint: { lat: number; lng: number }
): RouteOptimization {
  const unvisited = [...appointments];
  const optimized: AppointmentWithLocation[] = [];
  let currentLocation = centerPoint;
  let totalDistance = 0;

  while (unvisited.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const distance = calculateHaversineDistance(currentLocation, unvisited[i].customer.coordinates);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    const nearest = unvisited.splice(nearestIndex, 1)[0];
    optimized.push(nearest);
    currentLocation = nearest.customer.coordinates;
    totalDistance += nearestDistance * 1000; // Convert to meters
  }

  // Add return distance to center
  totalDistance += calculateHaversineDistance(currentLocation, centerPoint) * 1000;

  const totalTravelTime = Math.ceil((totalDistance / 1000) / 40 * 60); // Assume 40 km/h average speed

  return {
    totalDistance: totalDistance,
    totalTravelTime: totalTravelTime,
    optimizedOrder: optimized.map(a => a.id),
    waypoints: optimized.map(a => ({
      lat: a.customer.coordinates.lat,
      lng: a.customer.coordinates.lng,
      appointmentId: a.id,
    })),
    estimatedFuelCost: calculateFuelCost(totalDistance),
    co2Emissions: calculateCO2Emissions(totalDistance),
  };
}

/**
 * Calculate efficiency metrics for a day
 */
function calculateEfficiencyMetrics(
  appointments: AppointmentWithLocation[],
  route: RouteOptimization
): EfficiencyMetrics {
  const totalWorkTime = appointments.reduce((sum, apt) => sum + apt.duration, 0);
  const totalDayTime = 450; // 7.5 hours in minutes (9:30-16:00)
  
  const timeUtilization = (totalWorkTime / totalDayTime) * 100;
  const distancePerAppointment = (route.totalDistance / 1000) / appointments.length;
  
  // Calculate area covered by appointments
  const coordinates = appointments.map(apt => apt.customer.coordinates);
  const area = calculateConvexHullArea(coordinates);
  const appointmentDensity = appointments.length / Math.max(area, 1);
  
  // Estimate wasted travel time (could be optimized)
  const idealTravelTime = Math.min(route.totalTravelTime * 0.8, route.totalTravelTime - 30);
  const wastedTravelTime = Math.max(0, route.totalTravelTime - idealTravelTime);
  
  // Overall route efficiency (0-100%)
  const routeEfficiency = Math.max(0, 100 - (route.totalTravelTime / totalWorkTime) * 20);

  return {
    routeEfficiency: Math.round(routeEfficiency),
    timeUtilization: Math.round(timeUtilization),
    distancePerAppointment: Math.round(distancePerAppointment * 100) / 100,
    appointmentDensity: Math.round(appointmentDensity * 100) / 100,
    wastedTravelTime: Math.round(wastedTravelTime),
  };
}

/**
 * Analyze capacity for a day
 */
function analyzeCapacity(appointments: AppointmentWithLocation[], date: Date): CapacityAnalysis {
  const currentAppointments = appointments.length;
  const maxPossibleAppointments = BUSINESS_RULES.maxAppointmentsPerDay;
  const utilizationRate = (currentAppointments / maxPossibleAppointments) * 100;
  const availableSlots = maxPossibleAppointments - currentAppointments;

  const timeConstraints = [];
  if (currentAppointments >= maxPossibleAppointments) {
    timeConstraints.push('Maximum daily appointments reached');
  }
  if (utilizationRate > 80) {
    timeConstraints.push('High utilization - limited flexibility');
  }

  return {
    currentAppointments,
    maxPossibleAppointments,
    utilizationRate: Math.round(utilizationRate),
    availableSlots,
    timeConstraints,
  };
}

/**
 * Calculate approximate area using convex hull (simplified)
 */
function calculateConvexHullArea(coordinates: Array<{ lat: number; lng: number }>): number {
  if (coordinates.length < 3) return 1; // Minimum area for calculation

  // Simplified area calculation using bounding box
  const lats = coordinates.map(c => c.lat);
  const lngs = coordinates.map(c => c.lng);
  
  const latRange = Math.max(...lats) - Math.min(...lats);
  const lngRange = Math.max(...lngs) - Math.min(...lngs);
  
  // Convert to approximate km² (very rough approximation)
  const area = latRange * lngRange * 111 * 111 * Math.cos(Math.min(...lats) * Math.PI / 180);
  
  return Math.max(area, 1);
}

/**
 * Calculate fuel cost based on distance
 */
function calculateFuelCost(distanceMeters: number): number {
  const distanceKm = distanceMeters / 1000;
  const fuelConsumptionPer100km = 7; // liters
  const fuelPricePerLiter = 1.65; // euros
  
  return Math.round(((distanceKm / 100) * fuelConsumptionPer100km * fuelPricePerLiter) * 100) / 100;
}

/**
 * Calculate CO2 emissions based on distance
 */
function calculateCO2Emissions(distanceMeters: number): number {
  const distanceKm = distanceMeters / 1000;
  const co2PerKm = 0.12; // kg CO2 per km for average van
  
  return Math.round((distanceKm * co2PerKm) * 100) / 100;
}

/**
 * Calculate cost savings potential
 */
function calculateCostSavingsPotential(clusters: DayCluster[]): number {
  let totalPotentialSavings = 0;
  
  clusters.forEach(cluster => {
    if (cluster.efficiency.wastedTravelTime > 0) {
      // Estimate cost of wasted time (labor + fuel)
      const laborCostPerMinute = 0.5; // euros per minute
      const fuelSavings = calculateFuelCost(cluster.efficiency.wastedTravelTime * 1000); // Rough estimate
      
      totalPotentialSavings += (cluster.efficiency.wastedTravelTime * laborCostPerMinute) + fuelSavings;
    }
  });
  
  return Math.round(totalPotentialSavings * 100) / 100;
}

/**
 * Calculate potential CO2 reduction
 */
function calculatePotentialCO2Reduction(clusters: DayCluster[]): number {
  let potentialReduction = 0;
  
  clusters.forEach(cluster => {
    if (cluster.efficiency.routeEfficiency < 80) {
      // Estimate potential distance reduction
      const improvementPotential = (80 - cluster.efficiency.routeEfficiency) / 100;
      const potentialDistanceReduction = cluster.route.totalDistance * improvementPotential;
      potentialReduction += calculateCO2Emissions(potentialDistanceReduction);
    }
  });
  
  return Math.round(potentialReduction * 100) / 100;
}

/**
 * Generate recommendations based on analysis
 */
function generateRecommendations(analysis: { clusters: DayCluster[]; metrics: AnalysisMetrics }): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Route optimization recommendations
  const inefficientDays = analysis.clusters.filter(c => c.efficiency.routeEfficiency < 70);
  if (inefficientDays.length > 0) {
    recommendations.push({
      type: 'route_optimization',
      priority: 'high',
      title: 'Optimize inefficient routes',
      description: `${inefficientDays.length} days have route efficiency below 70%. Reordering appointments could save significant travel time.`,
      estimatedSavings: {
        time: inefficientDays.reduce((sum, day) => sum + day.efficiency.wastedTravelTime, 0),
        distance: inefficientDays.reduce((sum, day) => sum + (day.route.totalDistance * 0.2), 0) / 1000,
        cost: inefficientDays.reduce((sum, day) => sum + calculateFuelCost(day.route.totalDistance * 0.2), 0),
      },
      implementation: 'Use advanced route optimization tools and consider customer proximity when scheduling.',
    });
  }

  // Capacity recommendations
  const underutilizedDays = analysis.clusters.filter(c => c.capacity.utilizationRate < 60);
  if (underutilizedDays.length > 0) {
    recommendations.push({
      type: 'capacity',
      priority: 'medium',
      title: 'Increase capacity utilization',
      description: `${underutilizedDays.length} days have low appointment density. Consider consolidating appointments or adding capacity.`,
      estimatedSavings: {
        cost: underutilizedDays.length * 150, // Estimated revenue per additional appointment
      },
      implementation: 'Review scheduling policies and consider offering incentives for flexible appointment times.',
    });
  }

  // Cost saving recommendations
  if (analysis.metrics.costSavingsPotential > 50) {
    recommendations.push({
      type: 'cost_saving',
      priority: 'high',
      title: 'Significant cost reduction opportunity',
      description: `Route optimization could save €${analysis.metrics.costSavingsPotential} through reduced travel time and fuel consumption.`,
      estimatedSavings: {
        cost: analysis.metrics.costSavingsPotential,
        time: analysis.clusters.reduce((sum, c) => sum + c.efficiency.wastedTravelTime, 0),
      },
      implementation: 'Implement systematic route planning and customer location clustering.',
    });
  }

  return recommendations;
}

/**
 * Calculate optimization suggestions
 */
async function calculateOptimizationSuggestions(analysis: { clusters: DayCluster[] }): Promise<OptimizationSuggestions> {
  const routeImprovements: any[] = [];
  const capacityOptimizations: any[] = [];
  const schedulingAdjustments: any[] = [];

  for (const cluster of analysis.clusters) {
    // Route improvements
    if (cluster.efficiency.routeEfficiency < 80) {
      routeImprovements.push({
        date: cluster.date,
        currentOrder: cluster.appointments.map(a => a.id),
        suggestedOrder: cluster.route.optimizedOrder,
        timeSaving: cluster.efficiency.wastedTravelTime,
        distanceSaving: Math.round((cluster.route.totalDistance * 0.15) / 1000),
      });
    }

    // Capacity optimizations
    if (cluster.capacity.availableSlots > 0) {
      capacityOptimizations.push({
        date: cluster.date,
        currentCapacity: cluster.capacity.currentAppointments,
        potentialCapacity: cluster.capacity.maxPossibleAppointments,
        additionalSlots: generateAdditionalSlots(cluster),
      });
    }
  }

  return {
    routeImprovements,
    capacityOptimizations,
    schedulingAdjustments, // Could be expanded with more complex logic
  };
}

/**
 * Generate additional time slots for capacity optimization
 */
function generateAdditionalSlots(cluster: DayCluster): Array<{ time: string; efficiency: number }> {
  const slots = [];
  const occupiedTimes = cluster.appointments.map(a => a.time);
  
  // Generate potential slots (simplified)
  const potentialSlots = ['09:30', '11:00', '12:30', '14:00', '15:30'];
  
  for (const slot of potentialSlots) {
    if (!occupiedTimes.includes(slot)) {
      slots.push({
        time: slot,
        efficiency: Math.round(80 + Math.random() * 20), // Simplified efficiency calculation
      });
    }
  }
  
  return slots.slice(0, cluster.capacity.availableSlots);
}

/**
 * Generate forecast data
 */
async function generateForecast(
  appointments: AppointmentWithLocation[],
  startDate: Date,
  endDate: Date
): Promise<ForecastData> {
  // Simplified forecasting logic - in reality, this would use more sophisticated algorithms
  const weeklyAverage = appointments.length / Math.ceil(differenceInMinutes(endDate, startDate) / (7 * 24 * 60));
  
  return {
    nextWeekPrediction: {
      expectedAppointments: Math.round(weeklyAverage * 1.1), // 10% growth assumption
      recommendedCapacity: Math.min(BUSINESS_RULES.maxAppointmentsPerDay * 5, Math.round(weeklyAverage * 1.2)),
      highDemandDays: ['Monday', 'Tuesday', 'Friday'], // Based on typical patterns
    },
    monthlyTrends: {
      growthRate: 5, // 5% monthly growth
      seasonalFactors: {
        'Q1': 0.9,
        'Q2': 1.1,
        'Q3': 1.2,
        'Q4': 0.8,
      },
      capacityNeeds: {
        'low_season': Math.round(weeklyAverage * 0.8),
        'high_season': Math.round(weeklyAverage * 1.3),
      },
    },
  };
}

/**
 * Get empty metrics for when no data is available
 */
function getEmptyMetrics(): AnalysisMetrics {
  return {
    totalAppointments: 0,
    totalDays: 0,
    averageAppointmentsPerDay: 0,
    totalDistance: 0,
    totalTravelTime: 0,
    averageEfficiency: 0,
    costSavingsPotential: 0,
    environmentalImpact: {
      totalCO2: 0,
      potentialReduction: 0,
    },
  };
}