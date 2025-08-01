import { z } from 'zod';
import crypto from 'crypto';

// Configuration
const GHL_API_BASE_URL = 'https://rest.gohighlevel.com/v1';
const GHL_API_V2_BASE_URL = 'https://services.leadconnectorhq.com'; // 2024 API v2
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 30000; // 30 seconds
const REQUEST_TIMEOUT = 30000; // 30 seconds

// Response schemas
const ghlErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  statusCode: z.number().optional(),
});

const ghlContactResponseSchema = z.object({
  contact: z.object({
    id: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    tags: z.array(z.string()).optional(),
    customField: z.record(z.string(), z.any()).optional(),
  }),
});

const ghlOpportunityResponseSchema = z.object({
  opportunity: z.object({
    id: z.string(),
    name: z.string(),
    contactId: z.string(),
    pipelineId: z.string(),
    pipelineStageId: z.string(),
    status: z.string(),
    monetaryValue: z.number().optional(),
  }),
});

// Request schemas
const createNoteRequestSchema = z.object({
  contactId: z.string(),
  body: z.string(),
  userId: z.string().optional(),
});

const updateContactRequestSchema = z.object({
  tags: z.array(z.string()).optional(),
  customField: z.record(z.string(), z.any()).optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

const createTaskRequestSchema = z.object({
  contactId: z.string(),
  title: z.string(),
  body: z.string(),
  dueDate: z.string(), // ISO date string
  assignedTo: z.string().optional(),
  completed: z.boolean().optional().default(false),
});

// Error types
export class GHLAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorCode?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'GHLAPIError';
  }
}

export class GHLRateLimitError extends GHLAPIError {
  constructor(public retryAfter?: number) {
    super('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'GHLRateLimitError';
  }
}

export class GHLNetworkError extends GHLAPIError {
  constructor(message: string, public originalError?: Error) {
    super(message, undefined, 'NETWORK_ERROR');
    this.name = 'GHLNetworkError';
  }
}

// Retry logic
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateRetryDelay(attempt: number, baseDelay: number = INITIAL_RETRY_DELAY): number {
  // Exponential backoff with jitter
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), MAX_RETRY_DELAY);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  return Math.floor(exponentialDelay + jitter);
}

// Main API Client
export class GoHighLevelAPIClient {
  private apiKey: string;
  private locationId: string;
  private useV2API: boolean;
  private requestCount: number = 0;
  private lastRequestTime: number = 0;

  constructor(config: { apiKey: string; locationId: string; useV2API?: boolean }) {
    this.apiKey = config.apiKey;
    this.locationId = config.locationId;
    this.useV2API = config.useV2API ?? true; // Default to v2 API
  }

  /**
   * Make an API request with retry logic
   */
  private async makeRequest<T>(
    method: string,
    endpoint: string,
    data?: any,
    options: { maxRetries?: number; schema?: z.ZodSchema<T> } = {}
  ): Promise<T> {
    const { maxRetries = MAX_RETRIES, schema } = options;
    const baseUrl = this.useV2API ? GHL_API_V2_BASE_URL : GHL_API_BASE_URL;
    const url = `${baseUrl}${endpoint}`;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Rate limiting check
        this.checkRateLimit();

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        const response = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Version': this.useV2API ? '2021-07-28' : '2021-04-15',
          },
          body: data ? JSON.stringify(data) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        this.recordRequest();

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
          throw new GHLRateLimitError(retryAfter);
        }

        // Handle non-OK responses
        if (!response.ok) {
          const errorText = await response.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
            const parsedError = ghlErrorResponseSchema.parse(errorData);
            throw new GHLAPIError(
              parsedError.message || parsedError.error,
              response.status,
              parsedError.error,
              errorData
            );
          } catch (parseError) {
            throw new GHLAPIError(
              `API request failed: ${response.statusText}`,
              response.status,
              'API_ERROR',
              errorText
            );
          }
        }

        // Parse successful response
        const responseData = await response.json();
        
        // Validate response if schema provided
        if (schema) {
          return schema.parse(responseData);
        }
        
        return responseData as T;

      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx except 429)
        if (error instanceof GHLAPIError && error.statusCode && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
          throw error;
        }

        // Don't retry on the last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Calculate retry delay
        let retryDelay = calculateRetryDelay(attempt);
        
        if (error instanceof GHLRateLimitError && error.retryAfter) {
          retryDelay = error.retryAfter * 1000;
        }

        console.warn(`GHL API request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${retryDelay}ms...`, {
          endpoint,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        await sleep(retryDelay);
      }
    }

    // All retries exhausted
    if (lastError instanceof GHLAPIError) {
      throw lastError;
    } else if (lastError instanceof Error && lastError.name === 'AbortError') {
      throw new GHLNetworkError('Request timeout', lastError);
    } else {
      throw new GHLNetworkError(
        `Request failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`,
        lastError
      );
    }
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(): void {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    // Simple rate limiting: max 10 requests per second
    if (timeSinceLastRequest < 100 && this.requestCount >= 10) {
      throw new GHLRateLimitError(1);
    }
    
    // Reset counter every second
    if (timeSinceLastRequest >= 1000) {
      this.requestCount = 0;
      this.lastRequestTime = now;
    }
  }

  /**
   * Record a request for rate limiting
   */
  private recordRequest(): void {
    this.requestCount++;
    if (this.requestCount === 1) {
      this.lastRequestTime = Date.now();
    }
  }

  /**
   * Get contact by ID
   */
  async getContact(contactId: string): Promise<any> {
    return this.makeRequest(
      'GET',
      `/contacts/${contactId}`,
      undefined,
      { schema: ghlContactResponseSchema }
    );
  }

  /**
   * Update contact
   */
  async updateContact(contactId: string, updates: z.infer<typeof updateContactRequestSchema>): Promise<any> {
    const validatedData = updateContactRequestSchema.parse(updates);
    return this.makeRequest(
      'PUT',
      `/contacts/${contactId}`,
      validatedData,
      { schema: ghlContactResponseSchema }
    );
  }

  /**
   * Add note to contact
   */
  async addContactNote(data: z.infer<typeof createNoteRequestSchema>): Promise<any> {
    const validatedData = createNoteRequestSchema.parse(data);
    return this.makeRequest(
      'POST',
      `/contacts/${validatedData.contactId}/notes`,
      { body: validatedData.body, userId: validatedData.userId }
    );
  }

  /**
   * Create task for contact
   */
  async createTask(data: z.infer<typeof createTaskRequestSchema>): Promise<any> {
    const validatedData = createTaskRequestSchema.parse(data);
    return this.makeRequest(
      'POST',
      `/contacts/${validatedData.contactId}/tasks`,
      validatedData
    );
  }

  /**
   * Update opportunity (for appointment tracking)
   */
  async updateOpportunity(opportunityId: string, updates: any): Promise<any> {
    return this.makeRequest(
      'PUT',
      `/opportunities/${opportunityId}`,
      updates,
      { schema: ghlOpportunityResponseSchema }
    );
  }

  /**
   * Create appointment confirmation note
   */
  async createAppointmentConfirmation(
    contactId: string,
    appointmentDetails: {
      date: string;
      time: string;
      serviceType: string;
      location: string;
      appointmentId: string;
    }
  ): Promise<any> {
    const noteBody = `
🗓️ Afspraak Bevestigd

Datum: ${appointmentDetails.date}
Tijd: ${appointmentDetails.time}
Service: ${appointmentDetails.serviceType}
Locatie: ${appointmentDetails.location}
Afspraak ID: ${appointmentDetails.appointmentId}

Status: Bevestigd door klant
Bevestigd op: ${new Date().toISOString()}
    `.trim();

    return this.addContactNote({
      contactId,
      body: noteBody,
    });
  }

  /**
   * Update contact with appointment status
   */
  async updateContactAppointmentStatus(
    contactId: string,
    status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled',
    appointmentDate?: string
  ): Promise<any> {
    const customFields: Record<string, any> = {
      appointment_status: status,
      last_appointment_update: new Date().toISOString(),
    };

    if (appointmentDate) {
      customFields.next_appointment_date = appointmentDate;
    }

    const tags = [];
    switch (status) {
      case 'scheduled':
        tags.push('appointment-scheduled');
        break;
      case 'confirmed':
        tags.push('appointment-confirmed');
        break;
      case 'completed':
        tags.push('appointment-completed');
        tags.push('customer');
        break;
      case 'cancelled':
        tags.push('appointment-cancelled');
        break;
    }

    return this.updateContact(contactId, {
      customField: customFields,
      tags,
    });
  }

  /**
   * Batch update multiple contacts (with individual error handling)
   */
  async batchUpdateContacts(
    updates: Array<{ contactId: string; data: z.infer<typeof updateContactRequestSchema> }>
  ): Promise<Array<{ contactId: string; success: boolean; result?: any; error?: Error }>> {
    const results = await Promise.allSettled(
      updates.map(({ contactId, data }) =>
        this.updateContact(contactId, data).then(result => ({ contactId, success: true, result }))
      )
    );

    return results.map((result, index) => {
      const { contactId } = updates[index];
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          contactId,
          success: false,
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        };
      }
    });
  }
}

// Factory function
export function createGHLClient(config?: { apiKey?: string; locationId?: string; useV2API?: boolean }): GoHighLevelAPIClient {
  const apiKey = config?.apiKey || process.env.GHL_API_KEY || process.env.GOHIGHLEVEL_API_KEY;
  const locationId = config?.locationId || process.env.GHL_LOCATION_ID || process.env.GOHIGHLEVEL_LOCATION_ID || '';

  if (!apiKey) {
    throw new Error('GoHighLevel API key is required. Set GHL_API_KEY environment variable.');
  }

  return new GoHighLevelAPIClient({
    apiKey,
    locationId,
    useV2API: config?.useV2API ?? true,
  });
}