import { HandlerResponse } from '@netlify/functions';

/**
 * Helper function to create a properly typed Netlify Function response
 * Ensures all headers are defined strings
 */
export function createResponse(
  statusCode: number,
  body: any,
  headers: Record<string, string | undefined> = {}
): HandlerResponse {
  // Filter out undefined headers and ensure all values are strings
  const cleanHeaders: Record<string, string> = {};
  
  // Add default headers
  cleanHeaders['Content-Type'] = 'application/json';
  cleanHeaders['Access-Control-Allow-Origin'] = process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGIN || '*' 
    : 'http://localhost:3000';
  
  // Add custom headers, filtering out undefined values
  Object.entries(headers).forEach(([key, value]) => {
    if (value !== undefined) {
      cleanHeaders[key] = String(value);
    }
  });

  return {
    statusCode,
    headers: cleanHeaders,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

/**
 * Create a CORS preflight response
 */
export function createCorsResponse(methods: string = 'GET, POST, OPTIONS'): HandlerResponse {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': process.env.NODE_ENV === 'production' 
        ? process.env.ALLOWED_ORIGIN || '*' 
        : 'http://localhost:3000',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': methods,
    },
    body: '',
  };
}

/**
 * Create an error response
 */
export function createErrorResponse(
  statusCode: number,
  error: string,
  additionalData?: any,
  customHeaders?: Record<string, string | undefined>
): HandlerResponse {
  // If additionalData is an object with message/details properties, use it as is
  // Otherwise, if it's a string, treat it as message
  let body: any = { error };
  
  if (additionalData !== undefined) {
    if (typeof additionalData === 'object' && additionalData !== null) {
      // Merge the additional data into the body
      body = { ...body, ...additionalData };
    } else if (typeof additionalData === 'string') {
      // Treat string as message for backward compatibility
      body.message = additionalData;
    }
  }

  return createResponse(statusCode, body, customHeaders);
}