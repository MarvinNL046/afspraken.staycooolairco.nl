// Type definitions for Netlify Functions Calendar API

export type ServiceType = 
  | 'onderhoud' | 'storing' | 'inspectie' | 'installatie'  // Dutch
  | 'maintenance' | 'malfunction' | 'inspection' | 'installation';  // English

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'cancelled' | 'completed';

export type SyncDirection = 'toCalendar' | 'fromCalendar' | 'bidirectional';

// Customer information
export interface CustomerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
}

// Time slot information
export interface TimeSlot {
  id: string;
  startTime: string;  // HH:mm format
  endTime: string;    // HH:mm format
  isAvailable: boolean;
  displayTime: string;
}

// Business hours configuration
export interface BusinessHours {
  start: string;  // HH:mm format
  end: string;    // HH:mm format
  lunchBreak: {
    start: string;  // HH:mm format
    end: string;    // HH:mm format
  };
}

// Appointment details
export interface Appointment {
  id: string;
  date: string;  // YYYY-MM-DD format
  time: string;  // HH:mm format
  endTime: string;  // HH:mm format
  serviceType: ServiceType;
  status: AppointmentStatus;
  notes?: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    address: string;
  };
  contact?: {
    email: string;
    phone: string;
  };
  timezone: string;
  googleCalendarSynced: boolean;
  createdAt?: string;
}

// API Request Types
export interface CheckAvailabilityRequest {
  date: string;  // YYYY-MM-DD format
}

export interface CreateAppointmentRequest {
  date: string;  // YYYY-MM-DD format
  startTime: string;  // HH:mm format
  serviceType: ServiceType;
  customerInfo: CustomerInfo;
  notes?: string;
  bookingToken: string;
}

export interface UpdateAppointmentRequest {
  appointmentId: string;
  date?: string;  // YYYY-MM-DD format
  startTime?: string;  // HH:mm format
  serviceType?: ServiceType;
  notes?: string;
  bookingToken: string;
}

export interface CancelAppointmentRequest {
  appointmentId: string;
  reason?: string;
  bookingToken: string;
}

export interface GetAppointmentRequest {
  appointmentId?: string;
  bookingToken: string;
}

export interface SyncCalendarRequest {
  startDate: string;  // YYYY-MM-DD format
  endDate?: string;   // YYYY-MM-DD format
  direction: SyncDirection;
  apiKey: string;
}

// API Response Types
export interface CheckAvailabilityResponse {
  date: string;
  timezone: string;
  businessHours: BusinessHours;
  slotDuration: number;  // minutes
  slots: TimeSlot[];
  totalSlots: number;
  availableSlots: number;
}

export interface CreateAppointmentResponse {
  success: boolean;
  appointment: Appointment;
  message: string;
}

export interface UpdateAppointmentResponse {
  success: boolean;
  appointment: Appointment;
  message: string;
}

export interface CancelAppointmentResponse {
  success: boolean;
  message: string;
  appointmentId: string;
}

export interface GetSingleAppointmentResponse {
  success: boolean;
  appointment: Appointment;
}

export interface GetMultipleAppointmentsResponse {
  success: boolean;
  appointments: Appointment[];
  total: number;
}

export interface SyncCalendarResponse {
  success: boolean;
  summary: {
    totalSynced: number;
    created: number;
    updated: number;
    errors: number;
  };
  dateRange: {
    start: string;
    end: string;
    timezone: string;
  };
  direction: SyncDirection;
  details: Array<{
    appointmentId?: string;
    googleEventId?: string;
    action: 'created' | 'updated' | 'error' | 'orphaned_event' | 'calendar_fetch_error';
    error?: string;
    message?: string;
    summary?: string;
    start?: string;
  }>;
}

// Error Response
export interface ErrorResponse {
  error: string;
  message?: string;
  details?: any[];
}

// Type guards
export function isErrorResponse(response: any): response is ErrorResponse {
  return 'error' in response;
}

export function isGetSingleAppointmentResponse(response: any): response is GetSingleAppointmentResponse {
  return 'appointment' in response && !Array.isArray(response.appointment);
}

export function isGetMultipleAppointmentsResponse(response: any): response is GetMultipleAppointmentsResponse {
  return 'appointments' in response && Array.isArray(response.appointments);
}