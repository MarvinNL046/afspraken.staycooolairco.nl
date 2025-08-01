import { Handler } from '@netlify/functions';

/**
 * Simple Health Check Endpoint
 * Lightweight endpoint for load balancer health checks
 * 
 * GET /.netlify/functions/health-simple
 */
export const handler: Handler = async (event) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Simple health check - just return OK
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
    body: JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }),
  };
};