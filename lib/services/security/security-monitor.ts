/**
 * Security Monitoring Service
 * 
 * Real-time security monitoring, threat detection, and incident response
 */

import { logger } from '@/lib/services/logging/logger';
import { monitoring } from '@/lib/services/monitoring/monitor';
import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';

// Security event types
export enum SecurityEventType {
  // Authentication events
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILED = 'LOGIN_FAILED',
  LOGOUT = 'LOGOUT',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  
  // Authorization events
  ACCESS_GRANTED = 'ACCESS_GRANTED',
  ACCESS_DENIED = 'ACCESS_DENIED',
  PRIVILEGE_ESCALATION = 'PRIVILEGE_ESCALATION',
  
  // Input validation events
  VALIDATION_PASSED = 'VALIDATION_PASSED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  SQL_INJECTION_ATTEMPT = 'SQL_INJECTION_ATTEMPT',
  XSS_ATTEMPT = 'XSS_ATTEMPT',
  PATH_TRAVERSAL_ATTEMPT = 'PATH_TRAVERSAL_ATTEMPT',
  
  // Rate limiting events
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  RATE_LIMIT_WARNING = 'RATE_LIMIT_WARNING',
  
  // Security violations
  CSRF_VIOLATION = 'CSRF_VIOLATION',
  CORS_VIOLATION = 'CORS_VIOLATION',
  IP_BLOCKED = 'IP_BLOCKED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  BRUTE_FORCE_ATTEMPT = 'BRUTE_FORCE_ATTEMPT',
  
  // System security events
  SECURITY_SCAN = 'SECURITY_SCAN',
  VULNERABILITY_DETECTED = 'VULNERABILITY_DETECTED',
  SECURITY_UPDATE = 'SECURITY_UPDATE',
}

// Threat levels
export enum ThreatLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// Security incident interface
interface SecurityIncident {
  id: string;
  timestamp: Date;
  eventType: SecurityEventType;
  threatLevel: ThreatLevel;
  clientId: string;
  ipAddress: string;
  userAgent: string;
  path: string;
  method: string;
  details: Record<string, any>;
  blocked: boolean;
}

// Threat detection patterns
const THREAT_PATTERNS = {
  SQL_INJECTION: [
    /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b.*\b(from|where|table|database)\b)/i,
    /(';|";|--|\*|\/\*|\*\/|xp_|sp_)/i,
    /(\b(or|and)\b\s*\d+\s*=\s*\d+)/i,
  ],
  XSS: [
    /<script[^>]*>.*?<\/script>/gi,
    /(javascript|vbscript|onload|onerror|onmouseover|onclick):/i,
    /<iframe|<object|<embed|<svg/i,
  ],
  PATH_TRAVERSAL: [
    /\.\.[\/\\]/,
    /~[\/\\]/,
    /%2e%2e[%2f%5c]/i,
    /\x00/,
  ],
  COMMAND_INJECTION: [
    /[;&|`$].*?(cat|ls|rm|cp|mv|chmod|chown|wget|curl)/,
    /\$\(.*?\)/,
    /`.*?`/,
  ],
};

/**
 * Security Monitoring Service
 */
export class SecurityMonitor {
  private incidents: LRUCache<string, SecurityIncident>;
  private threatScores: LRUCache<string, number>;
  private blockedClients: Set<string>;
  
  constructor() {
    // Store recent incidents
    this.incidents = new LRUCache<string, SecurityIncident>({
      max: 10000,
      ttl: 24 * 60 * 60 * 1000, // 24 hours
    });
    
    // Track threat scores per client
    this.threatScores = new LRUCache<string, number>({
      max: 50000,
      ttl: 60 * 60 * 1000, // 1 hour
    });
    
    // Blocked clients
    this.blockedClients = new Set<string>();
  }
  
  /**
   * Record security event
   */
  recordSecurityEvent(
    eventType: SecurityEventType,
    request: {
      headers: Headers;
      url: string;
      method: string;
    },
    details: Record<string, any> = {}
  ): SecurityIncident {
    const clientId = this.getClientId(request);
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const url = new URL(request.url);
    
    // Determine threat level
    const threatLevel = this.assessThreatLevel(eventType, details);
    
    // Create incident
    const incident: SecurityIncident = {
      id: `inc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      eventType,
      threatLevel,
      clientId,
      ipAddress,
      userAgent,
      path: url.pathname,
      method: request.method,
      details,
      blocked: false,
    };
    
    // Store incident
    this.incidents.set(incident.id, incident);
    
    // Update threat score
    this.updateThreatScore(clientId, eventType, threatLevel);
    
    // Check if client should be blocked
    if (this.shouldBlockClient(clientId)) {
      this.blockClient(clientId);
      incident.blocked = true;
    }
    
    // Log security event
    this.logSecurityEvent(incident);
    
    // Track in monitoring using generic metrics
    monitoring.metrics.increment('security_events_total', 1, {
      event_type: eventType,
      threat_level: threatLevel,
      blocked: incident.blocked ? 'true' : 'false',
    });
    
    return incident;
  }
  
  /**
   * Detect threats in input
   */
  detectThreats(input: string): {
    detected: boolean;
    threats: Array<{ type: string; pattern: string }>;
  } {
    const threats: Array<{ type: string; pattern: string }> = [];
    
    // Check SQL injection patterns
    for (const pattern of THREAT_PATTERNS.SQL_INJECTION) {
      if (pattern.test(input)) {
        threats.push({ type: 'SQL_INJECTION', pattern: pattern.toString() });
      }
    }
    
    // Check XSS patterns
    for (const pattern of THREAT_PATTERNS.XSS) {
      if (pattern.test(input)) {
        threats.push({ type: 'XSS', pattern: pattern.toString() });
      }
    }
    
    // Check path traversal patterns
    for (const pattern of THREAT_PATTERNS.PATH_TRAVERSAL) {
      if (pattern.test(input)) {
        threats.push({ type: 'PATH_TRAVERSAL', pattern: pattern.toString() });
      }
    }
    
    // Check command injection patterns
    for (const pattern of THREAT_PATTERNS.COMMAND_INJECTION) {
      if (pattern.test(input)) {
        threats.push({ type: 'COMMAND_INJECTION', pattern: pattern.toString() });
      }
    }
    
    return {
      detected: threats.length > 0,
      threats,
    };
  }
  
  /**
   * Check if client is blocked
   */
  isClientBlocked(request: { headers: Headers }): boolean {
    const clientId = this.getClientId(request);
    return this.blockedClients.has(clientId);
  }
  
  /**
   * Get client threat score
   */
  getClientThreatScore(request: { headers: Headers }): number {
    const clientId = this.getClientId(request);
    return this.threatScores.get(clientId) || 0;
  }
  
  /**
   * Get recent incidents
   */
  getRecentIncidents(limit: number = 100): SecurityIncident[] {
    const incidents: SecurityIncident[] = [];
    
    for (const [_, incident] of this.incidents.entries()) {
      incidents.push(incident);
      if (incidents.length >= limit) break;
    }
    
    return incidents.sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );
  }
  
  /**
   * Get security metrics
   */
  getSecurityMetrics(): {
    totalIncidents: number;
    incidentsByType: Record<string, number>;
    incidentsByThreatLevel: Record<string, number>;
    blockedClients: number;
    averageThreatScore: number;
  } {
    const incidentsByType: Record<string, number> = {};
    const incidentsByThreatLevel: Record<string, number> = {};
    let totalThreatScore = 0;
    let clientCount = 0;
    
    // Count incidents
    for (const [_, incident] of this.incidents.entries()) {
      incidentsByType[incident.eventType] = (incidentsByType[incident.eventType] || 0) + 1;
      incidentsByThreatLevel[incident.threatLevel] = (incidentsByThreatLevel[incident.threatLevel] || 0) + 1;
    }
    
    // Calculate average threat score
    for (const [_, score] of this.threatScores.entries()) {
      totalThreatScore += score;
      clientCount++;
    }
    
    return {
      totalIncidents: this.incidents.size,
      incidentsByType,
      incidentsByThreatLevel,
      blockedClients: this.blockedClients.size,
      averageThreatScore: clientCount > 0 ? totalThreatScore / clientCount : 0,
    };
  }
  
  /**
   * Clear old incidents
   */
  cleanupOldIncidents(olderThan: Date): number {
    let removed = 0;
    
    for (const [id, incident] of this.incidents.entries()) {
      if (incident.timestamp < olderThan) {
        this.incidents.delete(id);
        removed++;
      }
    }
    
    return removed;
  }
  
  // Private methods
  
  private getClientId(request: { headers: Headers }): string {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const identifier = `${ip}:${userAgent}`;
    return createHash('sha256').update(identifier).digest('hex').substring(0, 16);
  }
  
  private assessThreatLevel(
    eventType: SecurityEventType,
    details: Record<string, any>
  ): ThreatLevel {
    // Critical threats
    const criticalEvents = [
      SecurityEventType.SQL_INJECTION_ATTEMPT,
      SecurityEventType.PRIVILEGE_ESCALATION,
      SecurityEventType.VULNERABILITY_DETECTED,
    ];
    if (criticalEvents.includes(eventType)) {
      return ThreatLevel.CRITICAL;
    }
    
    // High threats
    const highEvents = [
      SecurityEventType.XSS_ATTEMPT,
      SecurityEventType.PATH_TRAVERSAL_ATTEMPT,
      SecurityEventType.BRUTE_FORCE_ATTEMPT,
      SecurityEventType.CSRF_VIOLATION,
    ];
    if (highEvents.includes(eventType)) {
      return ThreatLevel.HIGH;
    }
    
    // Medium threats
    const mediumEvents = [
      SecurityEventType.RATE_LIMIT_EXCEEDED,
      SecurityEventType.CORS_VIOLATION,
      SecurityEventType.LOGIN_FAILED,
      SecurityEventType.ACCESS_DENIED,
    ];
    if (mediumEvents.includes(eventType)) {
      return ThreatLevel.MEDIUM;
    }
    
    return ThreatLevel.LOW;
  }
  
  private updateThreatScore(
    clientId: string,
    eventType: SecurityEventType,
    threatLevel: ThreatLevel
  ): void {
    const currentScore = this.threatScores.get(clientId) || 0;
    
    // Calculate score increment based on threat level
    const scoreIncrement = {
      [ThreatLevel.LOW]: 1,
      [ThreatLevel.MEDIUM]: 5,
      [ThreatLevel.HIGH]: 20,
      [ThreatLevel.CRITICAL]: 100,
    }[threatLevel];
    
    this.threatScores.set(clientId, currentScore + scoreIncrement);
  }
  
  private shouldBlockClient(clientId: string): boolean {
    const score = this.threatScores.get(clientId) || 0;
    
    // Block if score exceeds threshold
    if (score >= 100) {
      return true;
    }
    
    // Check for repeated high-risk events
    const recentIncidents = Array.from(this.incidents.values())
      .filter(inc => inc.clientId === clientId)
      .filter(inc => 
        inc.timestamp.getTime() > Date.now() - 15 * 60 * 1000 // Last 15 minutes
      );
    
    const highRiskCount = recentIncidents.filter(
      inc => inc.threatLevel === ThreatLevel.HIGH || inc.threatLevel === ThreatLevel.CRITICAL
    ).length;
    
    return highRiskCount >= 3;
  }
  
  private blockClient(clientId: string): void {
    this.blockedClients.add(clientId);
    
    logger.error('Client blocked due to security threats', undefined, {
      clientId,
      threatScore: this.threatScores.get(clientId),
    });
  }
  
  private logSecurityEvent(incident: SecurityIncident): void {
    const logLevel = {
      [ThreatLevel.LOW]: 'info',
      [ThreatLevel.MEDIUM]: 'warn',
      [ThreatLevel.HIGH]: 'error',
      [ThreatLevel.CRITICAL]: 'fatal',
    }[incident.threatLevel] as 'info' | 'warn' | 'error' | 'fatal';
    
    // Use appropriate logger method based on level
    const context = {
      incidentId: incident.id,
      threatLevel: incident.threatLevel,
      clientId: incident.clientId,
      path: incident.path,
      method: incident.method,
      blocked: incident.blocked,
      details: incident.details,
    };
    
    if (logLevel === 'fatal' || logLevel === 'error') {
      logger[logLevel](`Security Event: ${incident.eventType}`, undefined, context);
    } else {
      logger[logLevel](`Security Event: ${incident.eventType}`, context);
    }
  }
}

// Export singleton instance
export const securityMonitor = new SecurityMonitor();