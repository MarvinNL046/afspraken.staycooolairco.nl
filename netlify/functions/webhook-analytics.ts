import { Handler } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { parseISO, isValid, format, startOfDay, endOfDay, subDays, subWeeks, subMonths } from 'date-fns';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';

const prisma = new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

// Analytics query schema
const analyticsQuerySchema = z.object({
  timeframe: z.enum(['24h', '7d', '30d', '90d']).optional().default('7d'),
  source: z.string().optional(),
  includeDetails: z.boolean().optional().default(false),
  serviceAreaOnly: z.boolean().optional().default(false),
});

interface WebhookAnalytics {
  summary: {
    totalEvents: number;
    processedEvents: number;
    failedEvents: number;
    uniqueLeads: number;
    inServiceAreaLeads: number;
    conversionRate: number;
    successRate: number;
  };
  breakdown: {
    byEventType: Record<string, number>;
    bySource: Record<string, number>;
    byServiceArea: {
      eligible: number;
      ineligible: number;
      unknown: number;
    };
    byStatus: Record<string, number>;
  };
  timeline: Array<{
    date: string;
    events: number;
    leads: number;
    conversions: number;
  }>;
  performance: {
    averageProcessingTime: number;
    errorRate: number;
    duplicateRate: number;
    recentErrors: Array<{
      timestamp: string;
      eventType: string;
      error: string;
    }>;
  };
  topSources: Array<{
    source: string;
    events: number;
    leads: number;
    successRate: number;
  }>;
}

/**
 * Webhook Analytics and Monitoring Function
 * 
 * Provides comprehensive analytics and monitoring for webhook events
 * including success rates, performance metrics, and conversion tracking.
 * 
 * Features:
 * - Event processing analytics
 * - Lead conversion tracking
 * - Service area eligibility metrics
 * - Performance monitoring
 * - Error analysis and alerts
 * - Timeline and trend analysis
 * 
 * Endpoint: /.netlify/functions/webhook-analytics
 * Method: GET
 * 
 * Query Parameters:
 * - timeframe: 24h | 7d | 30d | 90d (default: 7d)
 * - source: Filter by webhook source (optional)
 * - includeDetails: Include detailed breakdown (default: false)
 * - serviceAreaOnly: Include only service area eligible leads (default: false)
 * 
 * Response:
 * {
 *   "summary": {
 *     "totalEvents": 245,
 *     "processedEvents": 238,
 *     "failedEvents": 7,
 *     "uniqueLeads": 186,
 *     "inServiceAreaLeads": 142,
 *     "conversionRate": 76.2,
 *     "successRate": 97.1
 *   },
 *   "breakdown": {
 *     "byEventType": {
 *       "ContactCreate": 180,
 *       "ContactUpdate": 58,
 *       "OpportunityCreate": 7
 *     }
 *   },
 *   "timeline": [...],
 *   "performance": {...}
 * }
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('GET, OPTIONS');
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return createErrorResponse(405, 'Method not allowed', {
      allowedMethods: ['GET', 'OPTIONS']
    });
  }

  const startTime = Date.now();

  try {
    // Parse query parameters
    const params = event.queryStringParameters || {};
    let validatedParams;
    
    try {
      validatedParams = analyticsQuerySchema.parse({
        timeframe: params.timeframe,
        source: params.source,
        includeDetails: params.includeDetails === 'true',
        serviceAreaOnly: params.serviceAreaOnly === 'true',
      });
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return createErrorResponse(400, 'Invalid query parameters', {
          details: validationError.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          }))
        });
      }
      throw validationError;
    }

    // Calculate date range
    const endDate = new Date();
    let startDate: Date;
    
    switch (validatedParams.timeframe) {
      case '24h':
        startDate = subDays(endDate, 1);
        break;
      case '7d':
        startDate = subWeeks(endDate, 1);
        break;
      case '30d':
        startDate = subMonths(endDate, 1);
        break;
      case '90d':
        startDate = subMonths(endDate, 3);
        break;
      default:
        startDate = subWeeks(endDate, 1);
    }

    // Build base query filters
    const baseFilter: any = {
      processedAt: {
        gte: startDate,
        lte: endDate,
      }
    };

    if (validatedParams.source) {
      baseFilter.source = validatedParams.source;
    }

    // Generate analytics data
    const analytics = await generateAnalytics(baseFilter, validatedParams, startDate, endDate);

    const response = {
      success: true,
      timeframe: validatedParams.timeframe,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      filters: {
        source: validatedParams.source,
        serviceAreaOnly: validatedParams.serviceAreaOnly,
      },
      analytics: analytics,
      metadata: {
        generatedAt: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        cacheRecommendation: getCacheRecommendation(validatedParams.timeframe),
      }
    };

    // Set appropriate cache headers
    const cacheMaxAge = getCacheMaxAge(validatedParams.timeframe);
    
    return createResponse(200, response, {
      'Cache-Control': `public, max-age=${cacheMaxAge}`,
      'X-Processing-Time': `${Date.now() - startTime}ms`,
      'X-Analytics-Timeframe': validatedParams.timeframe,
    });

  } catch (error) {
    console.error('Webhook analytics error:', error);

    const errorDetails = {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - startTime,
    };

    console.error('Analytics error details:', errorDetails);

    return createErrorResponse(500, 'Analytics generation failed', {
      message: 'An error occurred while generating webhook analytics. Please try again later.',
      requestId: `analytics_${Date.now()}`,
    });
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Generate comprehensive analytics data
 */
async function generateAnalytics(
  baseFilter: any, 
  params: any, 
  startDate: Date, 
  endDate: Date
): Promise<WebhookAnalytics> {
  // TODO: Enable webhook events after running Prisma migration
  // Execute all queries in parallel for better performance
  const [
    webhookEvents,
    leads,
    appointments,
    errorEvents,
  ] = await Promise.all([
    // Get all webhook events in timeframe - DISABLED until migration
    // prisma.webhookEvent.findMany({
    //   where: baseFilter,
    //   include: {
    //     lead: params.includeDetails ? {
    //       select: {
    //         id: true,
    //         isInServiceArea: true,
    //         provincie: true,
    //         status: true,
    //       }
    //     } : false,
    //   },
    //   orderBy: { processedAt: 'desc' },
    // }),
    Promise.resolve([]), // Return empty array for now

    // Get leads created in timeframe
    prisma.lead.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        // TODO: Enable after migration
        // ...(params.source && { bronSysteem: params.source }),
        // ...(params.serviceAreaOnly && { isInServiceArea: true }),
      },
      select: {
        id: true,
        // TODO: Enable after migration
        // isInServiceArea: true,
        // provincie: true,
        // status: true,
        // bronSysteem: true,
        createdAt: true,
      },
    }),

    // Get appointments from leads in timeframe
    prisma.afspraak.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        customer: {
          OR: [
            { email: { in: [] } }, // Will be populated with lead emails
          ]
        }
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        customer: {
          select: { email: true }
        }
      },
    }),

    // Get recent error events - DISABLED until migration
    // prisma.webhookEvent.findMany({
    //   where: {
    //     ...baseFilter,
    //     isProcessed: false,
    //   },
    //   select: {
    //     processedAt: true,
    //     eventType: true,
    //     errorMessage: true,
    //   },
    //   orderBy: { processedAt: 'desc' },
    //   take: 10,
    // }),
    Promise.resolve([]), // Return empty array for now
  ]);

  // Calculate summary metrics - TODO: Enable after migration
  const totalEvents = 0; // webhookEvents.length;
  const processedEvents = 0; // webhookEvents.filter(e => e.isProcessed).length;
  const failedEvents = 0; // totalEvents - processedEvents;
  const uniqueLeads = leads.length;
  const inServiceAreaLeads = 0; // TODO: Enable after migration
  const appointmentCount = appointments.length;

  const conversionRate = uniqueLeads > 0 ? (appointmentCount / uniqueLeads) * 100 : 0;
  const successRate = totalEvents > 0 ? (processedEvents / totalEvents) * 100 : 0;

  // Generate breakdown analytics - TODO: Enable after migration
  const breakdown = {
    byEventType: {}, // TODO: Enable after migration

    bySource: {}, // TODO: Enable after migration

    byServiceArea: {
      eligible: 0, // TODO: Enable after migration
      ineligible: 0,
      unknown: leads.length,
    },

    byStatus: {}, // TODO: Enable after migration
  };

  // Generate timeline data
  const timeline = generateTimeline(webhookEvents, leads, appointments, startDate, endDate);

  // Calculate performance metrics - TODO: Enable after migration
  const averageProcessingTime = 0;
  const errorRate = 0;
  const duplicateRate = 0;

  // Generate top sources analytics - TODO: Enable after migration
  const sourceStats: any[] = []; // Empty for now

  return {
    summary: {
      totalEvents,
      processedEvents,
      failedEvents,
      uniqueLeads,
      inServiceAreaLeads,
      conversionRate: Math.round(conversionRate * 100) / 100,
      successRate: Math.round(successRate * 100) / 100,
    },
    breakdown,
    timeline,
    performance: {
      averageProcessingTime: Math.round(averageProcessingTime * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      duplicateRate: Math.round(duplicateRate * 100) / 100,
      recentErrors: [], // TODO: Enable after migration
    },
    topSources: sourceStats,
  };
}

/**
 * Generate timeline data for charts
 */
function generateTimeline(
  webhookEvents: any[],
  leads: any[],
  appointments: any[],
  startDate: Date,
  endDate: Date
): Array<{ date: string; events: number; leads: number; conversions: number }> {
  const timeline: Array<{ date: string; events: number; leads: number; conversions: number }> = [];
  
  const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const interval = daysDiff <= 7 ? 1 : daysDiff <= 30 ? 1 : 7; // Daily for week/month, weekly for longer

  for (let i = 0; i <= daysDiff; i += interval) {
    const date = new Date(startDate.getTime() + (i * 24 * 60 * 60 * 1000));
    const nextDate = new Date(date.getTime() + (interval * 24 * 60 * 60 * 1000));
    
    const dayEvents = webhookEvents.filter(e => 
      e.processedAt >= date && e.processedAt < nextDate
    ).length;
    
    const dayLeads = leads.filter(l => 
      l.createdAt >= date && l.createdAt < nextDate
    ).length;
    
    const dayConversions = appointments.filter(a => 
      a.createdAt >= date && a.createdAt < nextDate
    ).length;
    
    timeline.push({
      date: format(date, 'yyyy-MM-dd'),
      events: dayEvents,
      leads: dayLeads,
      conversions: dayConversions,
    });
  }
  
  return timeline;
}

/**
 * Get cache max age based on timeframe
 */
function getCacheMaxAge(timeframe: string): number {
  switch (timeframe) {
    case '24h':
      return 300; // 5 minutes
    case '7d':
      return 900; // 15 minutes
    case '30d':
      return 1800; // 30 minutes
    case '90d':
      return 3600; // 1 hour
    default:
      return 900;
  }
}

/**
 * Get cache recommendation text
 */
function getCacheRecommendation(timeframe: string): string {
  switch (timeframe) {
    case '24h':
      return 'Data refreshes every 5 minutes for real-time monitoring';
    case '7d':
      return 'Data refreshes every 15 minutes for recent trend analysis';
    case '30d':
      return 'Data refreshes every 30 minutes for monthly reporting';
    case '90d':
      return 'Data refreshes hourly for quarterly analysis';
    default:
      return 'Standard cache policy applied';
  }
}