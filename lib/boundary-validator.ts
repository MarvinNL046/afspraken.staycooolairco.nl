import { PrismaClient } from '@prisma/client';
import { googleMaps } from './google-maps';
import { redis, cacheKeys, cacheTTL, ensureRedisConnection } from './redis';
import { DutchAddress } from '../types/google-maps';

interface ValidationResult {
  isValid: boolean;
  serviceAreaId?: string;
  serviceAreaName?: string;
  province?: string;
  calendarColorId?: string;
  salesPersonName?: string;
  validationMethod: 'postal_code' | 'geocoding' | 'cache';
  confidence: number; // 0-100
  message?: string;
}

interface ServiceAreaConfig {
  id: string;
  name: string;
  province: string;
  calendarColorId?: string;
  salesPersonId?: string;
  salesPersonName?: string;
}

export class BoundaryValidator {
  private static instance: BoundaryValidator;
  private prisma: PrismaClient;
  private initialized: boolean = false;
  private serviceAreas: Map<string, ServiceAreaConfig> = new Map();

  private constructor() {
    this.prisma = new PrismaClient();
  }

  static getInstance(): BoundaryValidator {
    if (!BoundaryValidator.instance) {
      BoundaryValidator.instance = new BoundaryValidator();
    }
    return BoundaryValidator.instance;
  }

  /**
   * Initialize the validator by loading service areas
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load active service areas
      const areas = await this.prisma.$queryRaw<Array<{
        id: string;
        name: string;
        province: string;
        calendar_color_id: string | null;
        sales_person_id: string | null;
        sales_person_name: string | null;
      }>>`SELECT * FROM service_areas WHERE is_active = true`;

      // Cache service areas in memory
      areas.forEach(area => {
        this.serviceAreas.set(area.id, {
          id: area.id,
          name: area.name,
          province: area.province,
          calendarColorId: area.calendar_color_id || undefined,
          salesPersonId: area.sales_person_id || undefined,
          salesPersonName: area.sales_person_name || undefined
        });
      });

      this.initialized = true;
      await ensureRedisConnection();
    } catch (error) {
      console.error('Failed to initialize BoundaryValidator:', error);
      throw error;
    }
  }

  /**
   * Validate if an address is within service boundaries
   */
  async validateAddress(address: DutchAddress): Promise<ValidationResult> {
    await this.initialize();

    // Step 1: Check cache first
    const cacheKey = `boundary:${address.postalCode}:${address.city}`;
    const cached = await this.getCachedValidation(cacheKey);
    if (cached) {
      return { ...cached, validationMethod: 'cache' };
    }

    // Step 2: Quick postal code check
    const postalCodeResult = await this.validateByPostalCode(address.postalCode);
    if (postalCodeResult.confidence >= 90) {
      // High confidence from postal code alone
      await this.cacheValidation(cacheKey, postalCodeResult);
      return postalCodeResult;
    }

    // Step 3: Precise validation using Google Maps Geocoding
    const geocodingResult = await this.validateByGeocoding(address);
    
    // Combine results for best accuracy
    const finalResult = this.combineValidationResults(postalCodeResult, geocodingResult);
    
    // Cache the result
    await this.cacheValidation(cacheKey, finalResult);
    
    return finalResult;
  }

  /**
   * Validate using postal code ranges
   */
  private async validateByPostalCode(postalCode: string): Promise<ValidationResult> {
    try {
      // Extract numeric part (first 4 digits)
      const numericCode = parseInt(postalCode.substring(0, 4));
      
      // Check all service areas
      for (const [areaId, config] of this.serviceAreas) {
        const ranges = await this.prisma.$queryRaw<Array<{
          id: string;
          service_area_id: string;
          start_code: string;
          end_code: string;
          excluded_codes: string[];
        }>>`SELECT * FROM postal_code_ranges WHERE service_area_id = ${areaId}`;

        for (const range of ranges) {
          const startCode = parseInt(range.start_code);
          const endCode = parseInt(range.end_code);

          if (numericCode >= startCode && numericCode <= endCode) {
            // Check if it's in excluded codes
            if (range.excluded_codes.includes(postalCode)) {
              continue;
            }

            // Found a match
            return {
              isValid: true,
              serviceAreaId: areaId,
              serviceAreaName: config.name,
              province: config.province,
              calendarColorId: config.calendarColorId,
              salesPersonName: config.salesPersonName,
              validationMethod: 'postal_code',
              confidence: 85, // Good confidence from postal code
              message: `Postcode ${postalCode} is binnen ${config.name} servicegebied`
            };
          }
        }
      }

      // No match found
      return {
        isValid: false,
        validationMethod: 'postal_code',
        confidence: 85,
        message: `Postcode ${postalCode} ligt buiten het servicegebied`
      };
    } catch (error) {
      console.error('Postal code validation error:', error);
      return {
        isValid: false,
        validationMethod: 'postal_code',
        confidence: 0,
        message: 'Fout bij postcode validatie'
      };
    }
  }

  /**
   * Validate using Google Maps Geocoding API
   */
  private async validateByGeocoding(address: DutchAddress): Promise<ValidationResult> {
    try {
      // Geocode the address
      const geocodeResult = await googleMaps.geocodeAddress(address);
      
      if (!geocodeResult) {
        return {
          isValid: false,
          validationMethod: 'geocoding',
          confidence: 0,
          message: 'Adres kon niet worden gevonden'
        };
      }

      // For now, we'll need to make another call to get province information
      // This is a limitation of our current geocoding result structure
      // In a real implementation, we'd enhance the geocodeAddress method to return more details
      
      // Use the formatted address to determine province
      // This is a simplified approach - in production, you'd want to enhance
      // the geocoding service to return administrative area information
      const isInLimburg = geocodeResult.formattedAddress.toLowerCase().includes('limburg');

      // Check if address is in Limburg based on formatted address
      // This is a simplified check - in production, enhance the geocoding service
      if (isInLimburg) {
        // Find Limburg service area
        for (const [areaId, config] of this.serviceAreas) {
          if (config.province.toLowerCase() === 'limburg') {
            return {
              isValid: true,
              serviceAreaId: areaId,
              serviceAreaName: config.name,
              province: 'Limburg',
              calendarColorId: config.calendarColorId,
              salesPersonName: config.salesPersonName,
              validationMethod: 'geocoding',
              confidence: 85, // Slightly lower confidence due to simple text matching
              message: `Adres bevestigd in ${config.name}`
            };
          }
        }
      }

      // Not in Limburg or service area not found
      return {
        isValid: false,
        validationMethod: 'geocoding',
        confidence: 85,
        message: 'Adres ligt buiten het servicegebied'
      };
    } catch (error) {
      console.error('Geocoding validation error:', error);
      return {
        isValid: false,
        validationMethod: 'geocoding',
        confidence: 0,
        message: 'Fout bij adres validatie'
      };
    }
  }

  /**
   * Combine validation results for best accuracy
   */
  private combineValidationResults(
    postalResult: ValidationResult,
    geocodingResult: ValidationResult
  ): ValidationResult {
    // If geocoding has high confidence and matches postal code result
    if (geocodingResult.confidence >= 90) {
      if (geocodingResult.isValid === postalResult.isValid) {
        // Both agree - highest confidence
        return {
          ...geocodingResult,
          confidence: 100,
          message: geocodingResult.message + ' (bevestigd)'
        };
      } else {
        // Disagreement - trust geocoding but lower confidence
        return {
          ...geocodingResult,
          confidence: 75,
          message: geocodingResult.message + ' (postcode check afwijkend)'
        };
      }
    }

    // If geocoding failed, use postal code result
    if (geocodingResult.confidence === 0) {
      return postalResult;
    }

    // Average the results
    const avgConfidence = (postalResult.confidence + geocodingResult.confidence) / 2;
    
    // Prefer geocoding result if both are valid
    if (geocodingResult.isValid && postalResult.isValid) {
      return {
        ...geocodingResult,
        confidence: avgConfidence
      };
    }

    // Return the negative result with averaged confidence
    return {
      isValid: false,
      validationMethod: 'geocoding',
      confidence: avgConfidence,
      message: 'Adres ligt buiten het servicegebied'
    };
  }

  /**
   * Batch validate multiple addresses
   */
  async batchValidateAddresses(
    addresses: DutchAddress[]
  ): Promise<ValidationResult[]> {
    await this.initialize();

    // Process in parallel with rate limiting
    const batchSize = 5;
    const results: ValidationResult[] = [];

    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(addr => this.validateAddress(addr))
      );
      results.push(...batchResults);

      // Rate limiting delay
      if (i + batchSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Get service area details by ID
   */
  async getServiceArea(serviceAreaId: string): Promise<ServiceAreaConfig | null> {
    await this.initialize();
    return this.serviceAreas.get(serviceAreaId) || null;
  }

  /**
   * Get all active service areas
   */
  async getAllServiceAreas(): Promise<ServiceAreaConfig[]> {
    await this.initialize();
    return Array.from(this.serviceAreas.values());
  }

  /**
   * Check if postal code is likely in Limburg (quick check)
   */
  isLikelyLimburgPostalCode(postalCode: string): boolean {
    const numericCode = parseInt(postalCode.substring(0, 4));
    // Limburg postal codes typically range from 5800-6999
    return numericCode >= 5800 && numericCode <= 6999;
  }

  /**
   * Cache validation result
   */
  private async cacheValidation(
    key: string,
    result: ValidationResult
  ): Promise<void> {
    try {
      // Cache for 30 days
      await redis.set(key, result, 30 * 24 * 60 * 60);
    } catch (error) {
      console.error('Cache storage error:', error);
    }
  }

  /**
   * Get cached validation result
   */
  private async getCachedValidation(
    key: string
  ): Promise<ValidationResult | null> {
    try {
      return await redis.get<ValidationResult>(key);
    } catch (error) {
      console.error('Cache retrieval error:', error);
      return null;
    }
  }

  /**
   * Clear validation cache
   */
  async clearCache(): Promise<void> {
    try {
      // Clear specific boundary validation keys
      // In production, implement pattern-based deletion
      await redis.flush();
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }

  /**
   * Update service area configuration
   */
  async updateServiceArea(
    serviceAreaId: string,
    updates: Partial<ServiceAreaConfig>
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE service_areas 
      SET 
        calendar_color_id = ${updates.calendarColorId || null},
        sales_person_id = ${updates.salesPersonId || null},
        sales_person_name = ${updates.salesPersonName || null},
        updated_at = NOW()
      WHERE id = ${serviceAreaId}
    `;

    // Refresh cached data
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Add postal code range to service area
   */
  async addPostalCodeRange(
    serviceAreaId: string,
    startCode: string,
    endCode: string,
    excludedCodes: string[] = []
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO postal_code_ranges (id, service_area_id, start_code, end_code, excluded_codes)
      VALUES (gen_random_uuid(), ${serviceAreaId}, ${startCode}, ${endCode}, ${excludedCodes}::text[])
    `;

    // Clear cache as boundaries have changed
    await this.clearCache();
  }

  /**
   * Cleanup and disconnect
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// Export singleton instance
export const boundaryValidator = BoundaryValidator.getInstance();

// Export convenience function for service area validation
export async function validateServiceArea(address: DutchAddress) {
  return await boundaryValidator.validateAddress(address);
}