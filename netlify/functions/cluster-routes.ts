import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z, ZodError } from 'zod';
import { googleMaps } from '../../lib/google-maps';
import { TravelMode, LatLng, DutchAddress } from '../../types/google-maps';
import { ensureRedisConnection, redis } from '../../lib/redis';
import jwt from 'jsonwebtoken';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import { startOfWeek, endOfWeek, addDays, format, parseISO, isWeekend, isSameDay, differenceInMinutes } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const prisma = new PrismaClient();

// Constants for business rules
const BUSINESS_HOURS = {
  start: '09:30',
  end: '16:00',
  appointmentDuration: 60, // minutes
  maxAppointmentsPerDay: 5,
  maxRadiusKm: 20,
  workDays: [1, 2, 3, 4, 5], // Monday to Friday
  bufferTimeMinutes: 15, // Buffer between appointments
};

// Calculate available minutes per day
const DAILY_AVAILABLE_MINUTES = 
  (parseInt(BUSINESS_HOURS.end.split(':')[0]) * 60 + parseInt(BUSINESS_HOURS.end.split(':')[1])) -
  (parseInt(BUSINESS_HOURS.start.split(':')[0]) * 60 + parseInt(BUSINESS_HOURS.start.split(':')[1]));

// Validation schemas
const clusteringRequestSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  centerPoint: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  travelMode: z.nativeEnum(TravelMode).default(TravelMode.DRIVING),
  optimizationStrategy: z.enum(['balanced', 'minimal_travel', 'maximum_appointments']).default('balanced'),
  apiKey: z.string().min(1, 'API key is required'),
});

interface AppointmentWithLocation {
  id: string;
  datum: Date;
  tijd: string;
  duur: number;
  latitude: number;
  longitude: number;
  address: string;
  priority?: number;
}

interface DayCluster {
  date: Date;
  appointments: AppointmentWithLocation[];
  totalTravelTime: number;
  totalDistance: number;
  efficiency: number;
  timeline: TimeSlot[];
}

interface TimeSlot {
  startTime: string;
  endTime: string;
  type: 'appointment' | 'travel' | 'break';
  appointmentId?: string;
  travelDistance?: number;
  travelDuration?: number;
}

interface ClusteringResult {
  clusters: DayCluster[];
  unassignedAppointments: AppointmentWithLocation[];
  summary: {
    totalAppointments: number;
    assignedAppointments: number;
    totalDays: number;
    averageEfficiency: number;
    totalTravelDistance: number;
    totalTravelTime: number;
  };
}

/**
 * Intelligent Route Clustering System
 * Endpoint: /.netlify/functions/cluster-routes
 * Method: POST
 * 
 * Features:
 * - Time-window constraints (9:30-16:00, Mon-Fri)
 * - 20km radius geographic clustering
 * - 5 appointments/day maximum
 * - Driving time calculation
 * - Efficiency scoring
 * - Performance optimization
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
    const validatedData = clusteringRequestSchema.parse(body);

    // Verify admin API key
    const adminApiKey = process.env.ADMIN_API_KEY || 'your-admin-api-key';
    if (validatedData.apiKey !== adminApiKey) {
      return createErrorResponse(401, 'Invalid API key');
    }

    // Ensure Redis is connected for caching
    await ensureRedisConnection();

    // Parse dates in Amsterdam timezone
    const startDate = parseISO(validatedData.startDate);
    const endDate = validatedData.endDate ? parseISO(validatedData.endDate) : addDays(startDate, 7);

    // Get center point (default to Amsterdam center)
    const centerPoint = validatedData.centerPoint || {
      lat: 52.3676,
      lng: 4.9041
    };

    // Fetch unassigned appointments within date range
    const appointments = await fetchUnassignedAppointments(startDate, endDate);

    // Filter appointments within radius
    const appointmentsWithinRadius = await filterAppointmentsByRadius(
      appointments,
      centerPoint,
      BUSINESS_HOURS.maxRadiusKm
    );

    // Perform intelligent clustering
    const clusteringResult = await performIntelligentClustering(
      appointmentsWithinRadius,
      centerPoint,
      startDate,
      endDate,
      validatedData.travelMode,
      validatedData.optimizationStrategy
    );

    // Create route clusters in database
    await createRouteClusters(clusteringResult.clusters);

    // Calculate performance metrics
    const performanceMetrics = calculatePerformanceMetrics(clusteringResult);

    return createResponse(200, {
      success: true,
      result: clusteringResult,
      performance: performanceMetrics,
      configuration: {
        businessHours: BUSINESS_HOURS,
        dateRange: {
          start: format(startDate, 'yyyy-MM-dd'),
          end: format(endDate, 'yyyy-MM-dd'),
        },
        centerPoint,
        radiusKm: BUSINESS_HOURS.maxRadiusKm,
        travelMode: validatedData.travelMode,
        strategy: validatedData.optimizationStrategy,
      },
    });

  } catch (error) {
    console.error('Route clustering error:', error);

    if (error instanceof ZodError) {
      return createErrorResponse(400, 'Validation error', {
        details: error.issues,
      });
    }

    return createErrorResponse(500, 'Internal server error', {
      message: 'An error occurred while clustering routes',
    });
  } finally {
    await prisma.$disconnect();
  }
};

async function fetchUnassignedAppointments(
  startDate: Date,
  endDate: Date
): Promise<AppointmentWithLocation[]> {
  const appointments = await prisma.afspraak.findMany({
    where: {
      datum: {
        gte: startDate,
        lte: endDate,
      },
      status: {
        in: ['gepland', 'bevestigd'],
      },
      routeClusterId: null,
      // CRITICAL: Only cluster sales team appointments (yellow/5)
      colorId: '5',
      OR: [
        {
          customer: {
            latitude: { not: null },
            longitude: { not: null },
          },
        },
        {
          lead: {
            latitude: { not: null },
            longitude: { not: null },
          },
        },
      ],
    },
    include: {
      customer: true,
      lead: true,
    },
  });

  return appointments.map(appointment => {
    const hasCustomer = appointment.customer && 
      appointment.customer.latitude && 
      appointment.customer.longitude;
    
    const location = hasCustomer && appointment.customer ? {
      latitude: appointment.customer.latitude!,
      longitude: appointment.customer.longitude!,
      address: `${appointment.customer.address}, ${appointment.customer.postalCode} ${appointment.customer.city}`,
    } : {
      latitude: appointment.lead!.latitude!,
      longitude: appointment.lead!.longitude!,
      address: `${appointment.lead!.adres}, ${appointment.lead!.postcode} ${appointment.lead!.stad}`,
    };

    return {
      id: appointment.id,
      datum: appointment.datum,
      tijd: appointment.tijd,
      duur: BUSINESS_HOURS.appointmentDuration, // Override with standard 1 hour
      ...location,
      priority: appointment.prioriteit || 0,
    };
  });
}

async function filterAppointmentsByRadius(
  appointments: AppointmentWithLocation[],
  centerPoint: LatLng,
  maxRadiusKm: number
): Promise<AppointmentWithLocation[]> {
  const filtered: AppointmentWithLocation[] = [];

  for (const appointment of appointments) {
    const distance = calculateHaversineDistance(
      centerPoint,
      { lat: appointment.latitude, lng: appointment.longitude }
    );

    if (distance <= maxRadiusKm) {
      filtered.push(appointment);
    }
  }

  return filtered;
}

function calculateHaversineDistance(point1: LatLng, point2: LatLng): number {
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

async function performIntelligentClustering(
  appointments: AppointmentWithLocation[],
  centerPoint: LatLng,
  startDate: Date,
  endDate: Date,
  travelMode: TravelMode,
  strategy: 'balanced' | 'minimal_travel' | 'maximum_appointments'
): Promise<ClusteringResult> {
  const clusters: DayCluster[] = [];
  const unassignedAppointments: AppointmentWithLocation[] = [];
  
  // Generate working days
  const workingDays = generateWorkingDays(startDate, endDate);
  
  // Sort appointments by priority and geographic proximity
  const sortedAppointments = await sortAppointmentsByStrategy(
    appointments,
    centerPoint,
    strategy
  );

  // Initialize day clusters
  const dayClusters = new Map<string, DayCluster>();
  workingDays.forEach(day => {
    const dateKey = format(day, 'yyyy-MM-dd');
    dayClusters.set(dateKey, {
      date: day,
      appointments: [],
      totalTravelTime: 0,
      totalDistance: 0,
      efficiency: 0,
      timeline: [],
    });
  });

  // Assign appointments to days using greedy algorithm with lookahead
  for (const appointment of sortedAppointments) {
    const appointmentDate = format(appointment.datum, 'yyyy-MM-dd');
    let assigned = false;

    // Try to assign to the appointment's preferred date first
    if (dayClusters.has(appointmentDate)) {
      const dayCluster = dayClusters.get(appointmentDate)!;
      if (await canAddAppointmentToDay(dayCluster, appointment, centerPoint, travelMode)) {
        await addAppointmentToCluster(dayCluster, appointment, centerPoint, travelMode);
        assigned = true;
      }
    }

    // If not assigned, try nearby days based on strategy
    if (!assigned) {
      const nearbyDays = getNearbyWorkingDays(appointment.datum, workingDays, strategy);
      
      for (const day of nearbyDays) {
        const dateKey = format(day, 'yyyy-MM-dd');
        const dayCluster = dayClusters.get(dateKey);
        
        if (dayCluster && await canAddAppointmentToDay(dayCluster, appointment, centerPoint, travelMode)) {
          await addAppointmentToCluster(dayCluster, appointment, centerPoint, travelMode);
          assigned = true;
          break;
        }
      }
    }

    if (!assigned) {
      unassignedAppointments.push(appointment);
    }
  }

  // Optimize each day's route
  for (const [dateKey, dayCluster] of dayClusters) {
    if (dayCluster.appointments.length > 0) {
      await optimizeDayRoute(dayCluster, centerPoint, travelMode);
      calculateDayEfficiency(dayCluster);
      clusters.push(dayCluster);
    }
  }

  // Calculate summary statistics
  const totalAppointments = appointments.length;
  const assignedAppointments = totalAppointments - unassignedAppointments.length;
  const totalDays = clusters.filter(c => c.appointments.length > 0).length;
  const averageEfficiency = clusters.reduce((sum, c) => sum + c.efficiency, 0) / (totalDays || 1);
  const totalTravelDistance = clusters.reduce((sum, c) => sum + c.totalDistance, 0);
  const totalTravelTime = clusters.reduce((sum, c) => sum + c.totalTravelTime, 0);

  return {
    clusters,
    unassignedAppointments,
    summary: {
      totalAppointments,
      assignedAppointments,
      totalDays,
      averageEfficiency,
      totalTravelDistance,
      totalTravelTime,
    },
  };
}

function generateWorkingDays(startDate: Date, endDate: Date): Date[] {
  const days: Date[] = [];
  let currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    if (!isWeekend(currentDate) && BUSINESS_HOURS.workDays.includes(currentDate.getDay())) {
      days.push(new Date(currentDate));
    }
    currentDate = addDays(currentDate, 1);
  }

  return days;
}

async function sortAppointmentsByStrategy(
  appointments: AppointmentWithLocation[],
  centerPoint: LatLng,
  strategy: string
): Promise<AppointmentWithLocation[]> {
  // Calculate distances from center
  const appointmentsWithDistance = appointments.map(apt => ({
    ...apt,
    distanceFromCenter: calculateHaversineDistance(
      centerPoint,
      { lat: apt.latitude, lng: apt.longitude }
    ),
  }));

  // Sort based on strategy
  switch (strategy) {
    case 'minimal_travel':
      // Sort by geographic clusters
      return appointmentsWithDistance.sort((a, b) => 
        a.distanceFromCenter - b.distanceFromCenter || (b.priority || 0) - (a.priority || 0)
      );
    
    case 'maximum_appointments':
      // Sort by priority and date
      return appointmentsWithDistance.sort((a, b) => 
        (b.priority || 0) - (a.priority || 0) || a.datum.getTime() - b.datum.getTime()
      );
    
    case 'balanced':
    default:
      // Balance between distance and priority
      return appointmentsWithDistance.sort((a, b) => {
        const scoreA = (a.priority || 0) * 2 - a.distanceFromCenter;
        const scoreB = (b.priority || 0) * 2 - b.distanceFromCenter;
        return scoreB - scoreA;
      });
  }
}

async function canAddAppointmentToDay(
  dayCluster: DayCluster,
  appointment: AppointmentWithLocation,
  centerPoint: LatLng,
  travelMode: TravelMode
): Promise<boolean> {
  // Check max appointments limit
  if (dayCluster.appointments.length >= BUSINESS_HOURS.maxAppointmentsPerDay) {
    return false;
  }

  // Check if appointment date matches cluster date
  if (!isSameDay(dayCluster.date, appointment.datum)) {
    return false;
  }

  // Calculate total time needed including travel
  const totalTimeNeeded = await calculateTotalTimeForDay(
    [...dayCluster.appointments, appointment],
    centerPoint,
    travelMode
  );

  return totalTimeNeeded <= DAILY_AVAILABLE_MINUTES;
}

async function calculateTotalTimeForDay(
  appointments: AppointmentWithLocation[],
  centerPoint: LatLng,
  travelMode: TravelMode
): Promise<number> {
  if (appointments.length === 0) return 0;

  let totalMinutes = 0;
  const cacheKey = `travel_time_${travelMode}_${appointments.map(a => a.id).join('_')}`;

  // Check cache
  const cached = await redis.get<string>(cacheKey);
  if (cached) {
    return parseInt(cached);
  }

  // Add travel from center to first appointment
  const firstTravel = await estimateTravelTime(
    centerPoint,
    { lat: appointments[0].latitude, lng: appointments[0].longitude },
    travelMode
  );
  totalMinutes += firstTravel;

  // Add appointment times and travel between appointments
  for (let i = 0; i < appointments.length; i++) {
    totalMinutes += appointments[i].duur + BUSINESS_HOURS.bufferTimeMinutes;

    if (i < appointments.length - 1) {
      const travelTime = await estimateTravelTime(
        { lat: appointments[i].latitude, lng: appointments[i].longitude },
        { lat: appointments[i + 1].latitude, lng: appointments[i + 1].longitude },
        travelMode
      );
      totalMinutes += travelTime;
    }
  }

  // Add travel from last appointment back to center
  const lastTravel = await estimateTravelTime(
    { lat: appointments[appointments.length - 1].latitude, lng: appointments[appointments.length - 1].longitude },
    centerPoint,
    travelMode
  );
  totalMinutes += lastTravel;

  // Cache result
  await redis.set(cacheKey, totalMinutes.toString(), 3600); // 1 hour cache

  return totalMinutes;
}

async function estimateTravelTime(
  origin: LatLng,
  destination: LatLng,
  travelMode: TravelMode
): Promise<number> {
  // Use haversine distance for quick estimation
  const distance = calculateHaversineDistance(origin, destination);
  
  // Estimate travel time based on mode and Dutch traffic patterns
  const speeds: Record<TravelMode, number> = {
    [TravelMode.DRIVING]: 40, // km/h average in urban areas
    [TravelMode.BICYCLING]: 18, // km/h average cycling speed
    [TravelMode.WALKING]: 5, // km/h walking speed
    [TravelMode.TRANSIT]: 30, // km/h average public transport
    [TravelMode.TWO_WHEELER]: 25, // km/h scooter/motorcycle
  };

  const speed = speeds[travelMode] || speeds[TravelMode.DRIVING];
  const travelMinutes = Math.ceil((distance / speed) * 60);

  // Add traffic factor for driving during rush hours
  if (travelMode === TravelMode.DRIVING) {
    const hour = new Date().getHours();
    if ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18)) {
      return Math.ceil(travelMinutes * 1.3); // 30% traffic penalty
    }
  }

  return travelMinutes;
}

async function addAppointmentToCluster(
  dayCluster: DayCluster,
  appointment: AppointmentWithLocation,
  centerPoint: LatLng,
  travelMode: TravelMode
): Promise<void> {
  dayCluster.appointments.push(appointment);
}

async function optimizeDayRoute(
  dayCluster: DayCluster,
  centerPoint: LatLng,
  travelMode: TravelMode
): Promise<void> {
  if (dayCluster.appointments.length <= 1) {
    // No optimization needed for single appointment
    await buildDayTimeline(dayCluster, centerPoint, travelMode);
    return;
  }

  try {
    // Use Google Maps optimization for accurate routing
    const waypoints = dayCluster.appointments.map(apt => ({
      lat: apt.latitude,
      lng: apt.longitude,
    }));

    const optimizedRoute = await googleMaps.optimizeRoute(
      centerPoint,
      waypoints,
      centerPoint,
      travelMode
    );

    // Reorder appointments based on optimization
    const optimizedAppointments = optimizedRoute.optimizedOrder.map(
      index => dayCluster.appointments[index]
    );
    dayCluster.appointments = optimizedAppointments;

    // Calculate actual distances and times
    const route = optimizedRoute.routes[0];
    dayCluster.totalDistance = route.legs.reduce((sum, leg) => sum + leg.distance.value, 0);
    dayCluster.totalTravelTime = Math.round(
      route.legs.reduce((sum, leg) => sum + leg.duration.value, 0) / 60
    );

    // Build detailed timeline
    await buildDayTimeline(dayCluster, centerPoint, travelMode);

  } catch (error) {
    console.error('Route optimization failed, using fallback:', error);
    // Fallback to simple nearest-neighbor algorithm
    await optimizeDayRouteFallback(dayCluster, centerPoint, travelMode);
  }
}

async function optimizeDayRouteFallback(
  dayCluster: DayCluster,
  centerPoint: LatLng,
  travelMode: TravelMode
): Promise<void> {
  // Simple nearest-neighbor algorithm
  const unvisited = [...dayCluster.appointments];
  const optimized: AppointmentWithLocation[] = [];
  let currentLocation = centerPoint;

  while (unvisited.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const distance = calculateHaversineDistance(currentLocation, {
        lat: unvisited[i].latitude,
        lng: unvisited[i].longitude,
      });

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    const nearest = unvisited.splice(nearestIndex, 1)[0];
    optimized.push(nearest);
    currentLocation = { lat: nearest.latitude, lng: nearest.longitude };
  }

  dayCluster.appointments = optimized;
  await buildDayTimeline(dayCluster, centerPoint, travelMode);
}

async function buildDayTimeline(
  dayCluster: DayCluster,
  centerPoint: LatLng,
  travelMode: TravelMode
): Promise<void> {
  const timeline: TimeSlot[] = [];
  let currentTime = BUSINESS_HOURS.start;
  let totalTravelDistance = 0;
  let totalTravelTime = 0;

  // Travel from center to first appointment
  if (dayCluster.appointments.length > 0) {
    const firstAppointment = dayCluster.appointments[0];
    const travelTime = await estimateTravelTime(
      centerPoint,
      { lat: firstAppointment.latitude, lng: firstAppointment.longitude },
      travelMode
    );
    const travelDistance = calculateHaversineDistance(centerPoint, {
      lat: firstAppointment.latitude,
      lng: firstAppointment.longitude,
    });

    timeline.push({
      startTime: currentTime,
      endTime: addMinutesToTime(currentTime, travelTime),
      type: 'travel',
      travelDistance: Math.round(travelDistance * 1000), // Convert to meters
      travelDuration: travelTime,
    });

    currentTime = addMinutesToTime(currentTime, travelTime);
    totalTravelDistance += travelDistance * 1000;
    totalTravelTime += travelTime;
  }

  // Add appointments and travel between them
  for (let i = 0; i < dayCluster.appointments.length; i++) {
    const appointment = dayCluster.appointments[i];

    // Add appointment slot
    timeline.push({
      startTime: currentTime,
      endTime: addMinutesToTime(currentTime, appointment.duur),
      type: 'appointment',
      appointmentId: appointment.id,
    });

    currentTime = addMinutesToTime(currentTime, appointment.duur + BUSINESS_HOURS.bufferTimeMinutes);

    // Add travel to next appointment or back to center
    if (i < dayCluster.appointments.length - 1) {
      const nextAppointment = dayCluster.appointments[i + 1];
      const travelTime = await estimateTravelTime(
        { lat: appointment.latitude, lng: appointment.longitude },
        { lat: nextAppointment.latitude, lng: nextAppointment.longitude },
        travelMode
      );
      const travelDistance = calculateHaversineDistance(
        { lat: appointment.latitude, lng: appointment.longitude },
        { lat: nextAppointment.latitude, lng: nextAppointment.longitude }
      );

      timeline.push({
        startTime: currentTime,
        endTime: addMinutesToTime(currentTime, travelTime),
        type: 'travel',
        travelDistance: Math.round(travelDistance * 1000),
        travelDuration: travelTime,
      });

      currentTime = addMinutesToTime(currentTime, travelTime);
      totalTravelDistance += travelDistance * 1000;
      totalTravelTime += travelTime;
    } else {
      // Travel back to center
      const travelTime = await estimateTravelTime(
        { lat: appointment.latitude, lng: appointment.longitude },
        centerPoint,
        travelMode
      );
      const travelDistance = calculateHaversineDistance(
        { lat: appointment.latitude, lng: appointment.longitude },
        centerPoint
      );

      timeline.push({
        startTime: currentTime,
        endTime: addMinutesToTime(currentTime, travelTime),
        type: 'travel',
        travelDistance: Math.round(travelDistance * 1000),
        travelDuration: travelTime,
      });

      totalTravelDistance += travelDistance * 1000;
      totalTravelTime += travelTime;
    }
  }

  dayCluster.timeline = timeline;
  dayCluster.totalDistance = Math.round(totalTravelDistance);
  dayCluster.totalTravelTime = Math.round(totalTravelTime);
}

function addMinutesToTime(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number);
  const totalMinutes = hours * 60 + mins + minutes;
  const newHours = Math.floor(totalMinutes / 60);
  const newMins = totalMinutes % 60;
  return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')}`;
}

function calculateDayEfficiency(dayCluster: DayCluster): void {
  if (dayCluster.appointments.length === 0) {
    dayCluster.efficiency = 0;
    return;
  }

  // Calculate efficiency score (0-100)
  const appointmentMinutes = dayCluster.appointments.length * 
    (BUSINESS_HOURS.appointmentDuration + BUSINESS_HOURS.bufferTimeMinutes);
  const totalMinutes = appointmentMinutes + dayCluster.totalTravelTime;
  const utilization = Math.min(totalMinutes / DAILY_AVAILABLE_MINUTES, 1);
  
  // Factor in number of appointments vs max
  const appointmentRatio = dayCluster.appointments.length / BUSINESS_HOURS.maxAppointmentsPerDay;
  
  // Factor in travel efficiency (less travel time is better)
  const travelEfficiency = 1 - (dayCluster.totalTravelTime / totalMinutes);
  
  // Combined efficiency score
  dayCluster.efficiency = Math.round(
    (utilization * 0.3 + appointmentRatio * 0.4 + travelEfficiency * 0.3) * 100
  );
}

function getNearbyWorkingDays(
  targetDate: Date,
  workingDays: Date[],
  strategy: string
): Date[] {
  // Sort working days by distance from target date
  const daysWithDistance = workingDays.map(day => ({
    day,
    distance: Math.abs(differenceInMinutes(day, targetDate)),
  }));

  daysWithDistance.sort((a, b) => a.distance - b.distance);

  // Return nearby days based on strategy
  const maxDaysToCheck = strategy === 'maximum_appointments' ? 5 : 3;
  return daysWithDistance.slice(0, maxDaysToCheck).map(d => d.day);
}

async function createRouteClusters(clusters: DayCluster[]): Promise<void> {
  for (const cluster of clusters) {
    if (cluster.appointments.length === 0) continue;

    // Create route cluster
    const routeCluster = await prisma.routeCluster.create({
      data: {
        datum: cluster.date,
        regio: `Auto-cluster ${format(cluster.date, 'dd-MM-yyyy')}`,
        naam: `Route ${format(cluster.date, 'EEEE dd-MM')}`,
        optimizedOrder: cluster.appointments.map(a => a.id),
        totalDistance: cluster.totalDistance,
        totalDuration: cluster.totalTravelTime,
        travelMode: TravelMode.DRIVING,
        optimizedAt: new Date(),
        notities: `Efficiency: ${cluster.efficiency}%, Appointments: ${cluster.appointments.length}`,
      },
    });

    // Update appointments with cluster ID
    await prisma.afspraak.updateMany({
      where: {
        id: {
          in: cluster.appointments.map(a => a.id),
        },
      },
      data: {
        routeClusterId: routeCluster.id,
      },
    });
  }
}

function calculatePerformanceMetrics(result: ClusteringResult) {
  const metrics = googleMaps.getPerformanceMetrics();
  
  return {
    processingTime: Date.now() - (metrics.recent[0]?.timestamp.getTime() || Date.now()),
    appointmentsProcessed: result.summary.totalAppointments,
    clustersCreated: result.clusters.length,
    efficiencyScore: result.summary.averageEfficiency,
    assignmentRate: (result.summary.assignedAppointments / result.summary.totalAppointments) * 100,
    averageAppointmentsPerDay: result.summary.assignedAppointments / (result.summary.totalDays || 1),
    totalSavedDistance: calculateSavedDistance(result),
    cacheHitRate: metrics.summary.cacheHitRate,
  };
}

function calculateSavedDistance(result: ClusteringResult): number {
  // Estimate saved distance by comparing to naive routing
  const naiveDistance = result.summary.totalAppointments * 40 * 1000; // 40km average per appointment
  const actualDistance = result.summary.totalTravelDistance;
  return Math.max(0, naiveDistance - actualDistance);
}