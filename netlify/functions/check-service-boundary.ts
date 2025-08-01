import { Handler } from '@netlify/functions';
import { z, ZodError } from 'zod';
import { boundaryValidator } from '../../lib/boundary-validator';
import { DutchAddress } from '../../types/google-maps';
import { createResponse, createCorsResponse, createErrorResponse } from '../../lib/netlify-helpers';
import jwt from 'jsonwebtoken';

// Validation schemas
const checkBoundarySchema = z.object({
  street: z.string().min(1, 'Street is required'),
  houseNumber: z.string().min(1, 'House number is required'),
  houseNumberAddition: z.string().optional(),
  postalCode: z.string().regex(/^\d{4}\s?[A-Z]{2}$/i, 'Invalid Dutch postal code'),
  city: z.string().min(1, 'City is required'),
  // Optional: for batch validation
  addresses: z.array(z.object({
    street: z.string(),
    houseNumber: z.string(),
    houseNumberAddition: z.string().optional(),
    postalCode: z.string(),
    city: z.string(),
  })).optional(),
});

/**
 * Service Boundary Check Function
 * Endpoint: /.netlify/functions/check-service-boundary
 * Methods: GET (quick check), POST (detailed validation)
 * 
 * Features:
 * - Quick postal code validation (GET)
 * - Full address validation with geocoding (POST)
 * - Batch address validation support
 * - Returns service area details and calendar color
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createCorsResponse('GET, POST, OPTIONS');
  }

  // Quick postal code check (GET)
  if (event.httpMethod === 'GET') {
    return handleQuickCheck(event);
  }

  // Detailed validation (POST)
  if (event.httpMethod === 'POST') {
    return handleDetailedValidation(event);
  }

  return createErrorResponse(405, 'Method not allowed');
};

/**
 * Quick postal code check without geocoding
 */
async function handleQuickCheck(event: any) {
  try {
    const postalCode = event.queryStringParameters?.postalCode;
    
    if (!postalCode) {
      return createErrorResponse(400, 'Postal code is required');
    }

    // Validate postal code format
    if (!/^\d{4}\s?[A-Z]{2}$/i.test(postalCode)) {
      return createErrorResponse(400, 'Invalid Dutch postal code format');
    }

    // Quick check based on postal code range
    const validator = boundaryValidator;
    const isLikely = validator.isLikelyLimburgPostalCode(postalCode);

    return createResponse(200, {
      postalCode: postalCode.toUpperCase().replace(/\s/g, ''),
      isLikelyInServiceArea: isLikely,
      confidence: 75, // Lower confidence for quick check
      message: isLikely 
        ? 'Postcode ligt waarschijnlijk in het servicegebied'
        : 'Postcode ligt waarschijnlijk buiten het servicegebied',
      note: 'Dit is een snelle check. Voor zekerheid, gebruik de POST methode met volledig adres.'
    });

  } catch (error) {
    console.error('Quick check error:', error);
    return createErrorResponse(500, 'Internal server error');
  }
}

/**
 * Detailed address validation with geocoding
 */
async function handleDetailedValidation(event: any) {
  try {
    // Parse request body
    if (!event.body) {
      return createErrorResponse(400, 'Request body is required');
    }

    const body = JSON.parse(event.body);
    
    // Optional: Check for booking token (for public access)
    const authHeader = event.headers.authorization;
    let isAuthenticated = false;
    
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        isAuthenticated = true;
      } catch {
        // Token invalid, continue as public request
      }
    }

    // Validate input
    const validatedData = checkBoundarySchema.parse(body);

    // Check if batch validation is requested
    if (validatedData.addresses && validatedData.addresses.length > 0) {
      return handleBatchValidation(validatedData.addresses, isAuthenticated);
    }

    // Single address validation
    const address: DutchAddress = {
      street: validatedData.street,
      houseNumber: validatedData.houseNumber,
      houseNumberExt: validatedData.houseNumberAddition,
      postalCode: validatedData.postalCode.toUpperCase().replace(/\s/g, ''),
      city: validatedData.city,
    };

    // Perform validation
    const result = await boundaryValidator.validateAddress(address);

    // Prepare response
    const response = {
      address: {
        street: address.street,
        houseNumber: address.houseNumber + (address.houseNumberExt || ''),
        postalCode: address.postalCode,
        city: address.city,
      },
      validation: {
        isInServiceArea: result.isValid,
        confidence: result.confidence,
        validationMethod: result.validationMethod,
        message: result.message,
      },
      serviceArea: result.isValid ? {
        id: result.serviceAreaId,
        name: result.serviceAreaName,
        province: result.province,
        calendarColorId: result.calendarColorId,
        salesPersonName: result.salesPersonName,
      } : null,
    };

    // Add additional info for authenticated requests
    if (isAuthenticated && result.isValid) {
      response.serviceArea = {
        ...response.serviceArea!,
        // Add any additional authenticated-only data
      };
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('Detailed validation error:', error);

    if (error instanceof ZodError) {
      return createErrorResponse(400, 'Validation error', {
        details: error.issues,
      });
    }

    return createErrorResponse(500, 'Internal server error');
  }
}

/**
 * Handle batch address validation
 */
async function handleBatchValidation(
  addresses: any[],
  isAuthenticated: boolean
) {
  try {
    // Limit batch size for non-authenticated requests
    const maxBatchSize = isAuthenticated ? 50 : 10;
    
    if (addresses.length > maxBatchSize) {
      return createErrorResponse(400, 
        `Batch size exceeds limit of ${maxBatchSize} addresses`
      );
    }

    // Convert to DutchAddress format
    const dutchAddresses: DutchAddress[] = addresses.map(addr => ({
      street: addr.street,
      houseNumber: addr.houseNumber,
      houseNumberExt: addr.houseNumberAddition,
      postalCode: addr.postalCode.toUpperCase().replace(/\s/g, ''),
      city: addr.city,
    }));

    // Perform batch validation
    const results = await boundaryValidator.batchValidateAddresses(dutchAddresses);

    // Format response
    const response = {
      totalAddresses: addresses.length,
      validAddresses: results.filter(r => r.isValid).length,
      invalidAddresses: results.filter(r => !r.isValid).length,
      results: results.map((result, index) => ({
        address: {
          street: dutchAddresses[index].street,
          houseNumber: dutchAddresses[index].houseNumber + 
            (dutchAddresses[index].houseNumberExt || ''),
          postalCode: dutchAddresses[index].postalCode,
          city: dutchAddresses[index].city,
        },
        isInServiceArea: result.isValid,
        confidence: result.confidence,
        message: result.message,
        serviceArea: result.isValid ? {
          name: result.serviceAreaName,
          calendarColorId: result.calendarColorId,
        } : null,
      })),
      summary: {
        limburgCount: results.filter(r => 
          r.isValid && r.serviceAreaName === 'Limburg'
        ).length,
        averageConfidence: Math.round(
          results.reduce((sum, r) => sum + r.confidence, 0) / results.length
        ),
      },
    };

    return createResponse(200, response);

  } catch (error) {
    console.error('Batch validation error:', error);
    return createErrorResponse(500, 'Batch validation failed');
  }
}

/**
 * Example responses:
 * 
 * GET /check-service-boundary?postalCode=6200AB
 * {
 *   "postalCode": "6200AB",
 *   "isLikelyInServiceArea": true,
 *   "confidence": 75,
 *   "message": "Postcode ligt waarschijnlijk in het servicegebied"
 * }
 * 
 * POST /check-service-boundary
 * {
 *   "street": "Markt",
 *   "houseNumber": "1",
 *   "postalCode": "6211CK",
 *   "city": "Maastricht"
 * }
 * 
 * Response:
 * {
 *   "address": {
 *     "street": "Markt",
 *     "houseNumber": "1",
 *     "postalCode": "6211CK",
 *     "city": "Maastricht"
 *   },
 *   "validation": {
 *     "isInServiceArea": true,
 *     "confidence": 100,
 *     "validationMethod": "geocoding",
 *     "message": "Adres bevestigd in Limburg (Limburg)"
 *   },
 *   "serviceArea": {
 *     "id": "uuid",
 *     "name": "Limburg",
 *     "province": "Limburg",
 *     "calendarColorId": "5",
 *     "salesPersonName": "Limburg Sales Team"
 *   }
 * }
 */