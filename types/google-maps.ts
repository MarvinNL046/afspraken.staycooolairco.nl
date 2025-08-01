// Type definitions for Google Maps integration with performance optimization

import { Client } from '@googlemaps/google-maps-services-js';

// Geocoding Types
export interface DutchAddress {
  street: string;
  houseNumber: string;
  houseNumberExt?: string; // Addition like 'A', 'bis'
  postalCode: string;
  city: string;
  country?: string;
}

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  placeId: string;
  formattedAddress: string;
  accuracy: GeocodeAccuracy;
  locationType: LocationType;
  viewport?: {
    northeast: LatLng;
    southwest: LatLng;
  };
}

export enum GeocodeAccuracy {
  ROOFTOP = 'ROOFTOP',
  RANGE_INTERPOLATED = 'RANGE_INTERPOLATED',
  GEOMETRIC_CENTER = 'GEOMETRIC_CENTER',
  APPROXIMATE = 'APPROXIMATE'
}

export enum LocationType {
  ROOFTOP = 'ROOFTOP',
  RANGE_INTERPOLATED = 'RANGE_INTERPOLATED',
  GEOMETRIC_CENTER = 'GEOMETRIC_CENTER',
  APPROXIMATE = 'APPROXIMATE'
}

// Coordinates
export interface LatLng {
  lat: number;
  lng: number;
}

// Routes API Types
export interface RouteRequest {
  origin: LatLng | string | DutchAddress;
  destination: LatLng | string | DutchAddress;
  waypoints?: Array<LatLng | string | DutchAddress>;
  travelMode: TravelMode;
  optimizeWaypoints?: boolean;
  alternatives?: boolean;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  language?: string;
  units?: UnitSystem;
  region?: string;
  departureTime?: Date;
  arrivalTime?: Date;
  trafficModel?: TrafficModel;
}

export interface RouteResponse {
  routes: Route[];
  geocodedWaypoints?: GeocodedWaypoint[];
}

export interface Route {
  summary: string;
  legs: RouteLeg[];
  waypointOrder?: number[];
  overviewPolyline: string;
  bounds: {
    northeast: LatLng;
    southwest: LatLng;
  };
  copyrights: string;
  warnings: string[];
  fare?: {
    currency: string;
    value: number;
    text: string;
  };
  distanceMeters: number;
  duration: string; // Duration in seconds as string (e.g., "1234s")
  staticDuration: string; // Duration without traffic
}

export interface RouteLeg {
  startAddress: string;
  endAddress: string;
  startLocation: LatLng;
  endLocation: LatLng;
  steps: RouteStep[];
  distance: {
    text: string;
    value: number; // meters
  };
  duration: {
    text: string;
    value: number; // seconds
  };
  durationInTraffic?: {
    text: string;
    value: number; // seconds
  };
}

export interface RouteStep {
  htmlInstructions: string;
  distance: {
    text: string;
    value: number;
  };
  duration: {
    text: string;
    value: number;
  };
  startLocation: LatLng;
  endLocation: LatLng;
  polyline: string;
  travelMode: TravelMode;
  maneuver?: string;
}

export interface GeocodedWaypoint {
  geocoderStatus: string;
  placeId: string;
  types: string[];
}

// Distance Matrix Types
export interface DistanceMatrixRequest {
  origins: Array<LatLng | string>;
  destinations: Array<LatLng | string>;
  travelMode: TravelMode;
  units?: UnitSystem;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  departureTime?: Date;
  arrivalTime?: Date;
  trafficModel?: TrafficModel;
  transitMode?: TransitMode[];
  transitRoutingPreference?: TransitRoutingPreference;
  language?: string;
  region?: string;
}

export interface DistanceMatrixResponse {
  originAddresses: string[];
  destinationAddresses: string[];
  rows: DistanceMatrixRow[];
}

export interface DistanceMatrixRow {
  elements: DistanceMatrixElement[];
}

export interface DistanceMatrixElement {
  status: ElementStatus;
  distance?: {
    text: string;
    value: number; // meters
  };
  duration?: {
    text: string;
    value: number; // seconds
  };
  durationInTraffic?: {
    text: string;
    value: number; // seconds
  };
  fare?: {
    currency: string;
    value: number;
    text: string;
  };
}

// Enums
export enum TravelMode {
  DRIVING = 'DRIVING',
  WALKING = 'WALKING',
  BICYCLING = 'BICYCLING',
  TRANSIT = 'TRANSIT',
  TWO_WHEELER = 'TWO_WHEELER' // Routes API only
}

export enum UnitSystem {
  METRIC = 'METRIC',
  IMPERIAL = 'IMPERIAL'
}

export enum TrafficModel {
  BEST_GUESS = 'best_guess',
  PESSIMISTIC = 'pessimistic',
  OPTIMISTIC = 'optimistic'
}

export enum TransitMode {
  BUS = 'bus',
  SUBWAY = 'subway',
  TRAIN = 'train',
  TRAM = 'tram',
  RAIL = 'rail'
}

export enum TransitRoutingPreference {
  LESS_WALKING = 'less_walking',
  FEWER_TRANSFERS = 'fewer_transfers'
}

export enum ElementStatus {
  OK = 'OK',
  NOT_FOUND = 'NOT_FOUND',
  ZERO_RESULTS = 'ZERO_RESULTS',
  MAX_ROUTE_LENGTH_EXCEEDED = 'MAX_ROUTE_LENGTH_EXCEEDED'
}

// Cache Types
export interface CachedGeocodingResult extends GeocodingResult {
  cachedAt: Date;
  expiresAt: Date;
  cacheKey: string;
}

export interface CachedRouteResult extends RouteResponse {
  cachedAt: Date;
  expiresAt: Date;
  cacheKey: string;
  trafficTimestamp?: Date;
}

export interface CacheOptions {
  ttl: number; // Time to live in seconds
  key: string;
  compress?: boolean;
}

// Performance Monitoring Types
export interface PerformanceMetrics {
  apiType: 'geocoding' | 'routes' | 'matrix';
  latency: number; // milliseconds
  cached: boolean;
  cacheHit: boolean;
  apiCost: number; // estimated cost in cents
  timestamp: Date;
  error?: string;
}

// Rate Limiting Types
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: any) => string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  retryAfter?: number;
}

// Error Types
export class GoogleMapsError extends Error {
  constructor(
    message: string,
    public code: string,
    public status?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'GoogleMapsError';
  }
}

export class RateLimitError extends GoogleMapsError {
  constructor(public retryAfter: number) {
    super('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429);
  }
}

export class QuotaExceededError extends GoogleMapsError {
  constructor() {
    super('Daily quota exceeded', 'QUOTA_EXCEEDED', 403);
  }
}

// Configuration Types
export interface GoogleMapsConfig {
  apiKey: string;
  defaultRegion?: string;
  defaultLanguage?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  cache?: {
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
    memory?: {
      max: number;
      ttl: number;
      sizeCalculation?: (value: any) => number;
    };
  };
  monitoring?: {
    enabled: boolean;
    metricsEndpoint?: string;
  };
}

// API Response Field Masks
export const FIELD_MASKS = {
  BASIC: 'routes.duration,routes.distanceMeters',
  ADVANCED: 'routes.duration,routes.distanceMeters,routes.polyline',
  FULL: 'routes.*'
} as const;

// Dutch-specific helpers
export interface DutchPostalCodeRegion {
  code: string; // First 2 digits of postal code
  province: string;
  region: string;
}

export const DUTCH_REGIONS: DutchPostalCodeRegion[] = [
  { code: '10', province: 'Noord-Holland', region: 'Amsterdam' },
  { code: '11', province: 'Noord-Holland', region: 'Amsterdam' },
  { code: '12', province: 'Noord-Holland', region: 'Amsterdam' },
  { code: '13', province: 'Noord-Holland', region: 'Amsterdam' },
  { code: '14', province: 'Noord-Holland', region: 'Zaanstreek' },
  { code: '15', province: 'Noord-Holland', region: 'Zaanstreek' },
  { code: '16', province: 'Noord-Holland', region: 'Kennemerland' },
  { code: '17', province: 'Noord-Holland', region: 'Kop van Noord-Holland' },
  { code: '18', province: 'Noord-Holland', region: 'Kop van Noord-Holland' },
  { code: '19', province: 'Noord-Holland', region: 'Kennemerland' },
  { code: '20', province: 'Noord-Holland', region: 'Haarlem' },
  { code: '21', province: 'Noord-Holland', region: 'Haarlem' },
  { code: '22', province: 'Zuid-Holland', region: 'Leiden' },
  { code: '23', province: 'Zuid-Holland', region: 'Leiden' },
  { code: '24', province: 'Zuid-Holland', region: 'Den Haag' },
  { code: '25', province: 'Zuid-Holland', region: 'Den Haag' },
  { code: '26', province: 'Zuid-Holland', region: 'Den Haag' },
  { code: '27', province: 'Zuid-Holland', region: 'Den Haag' },
  { code: '28', province: 'Zuid-Holland', region: 'Gouda' },
  { code: '29', province: 'Zuid-Holland', region: 'Rotterdam' },
  { code: '30', province: 'Zuid-Holland', region: 'Rotterdam' },
  { code: '31', province: 'Zuid-Holland', region: 'Rotterdam' },
  { code: '32', province: 'Zuid-Holland', region: 'Rotterdam' },
  { code: '33', province: 'Zuid-Holland', region: 'Dordrecht' },
  { code: '34', province: 'Utrecht', region: 'Utrecht-West' },
  { code: '35', province: 'Utrecht', region: 'Utrecht' },
  { code: '36', province: 'Utrecht', region: 'Utrecht-Oost' },
  { code: '37', province: 'Utrecht', region: 'Utrecht-Zuid' },
  { code: '38', province: 'Utrecht', region: 'Utrecht-Noord' },
  { code: '39', province: 'Utrecht', region: 'Het Gooi' },
  { code: '40', province: 'Utrecht', region: 'Amersfoort' },
  { code: '41', province: 'Utrecht', region: 'Amersfoort' },
  // Add more regions as needed
];