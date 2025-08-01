/**
 * Security Monitoring Service Unit Tests
 * 
 * Tests security monitoring, threat detection, and incident response
 */

import { SecurityMonitor } from '@/lib/services/security/security-monitor';
import { MonitoringService } from '@/lib/services/monitoring/monitor';
import { Logger } from '@/lib/services/logging/logger';
import { MetricsCollector } from '@/lib/services/monitoring/monitor';

// Mock dependencies
jest.mock('@/lib/services/monitoring/monitor');
jest.mock('@/lib/services/logging/logger');

describe('SecurityMonitor', () => {
  let securityMonitor: SecurityMonitor;
  let mockMonitoring: jest.Mocked<MonitoringService>;
  let mockLogger: jest.Mocked<Logger>;
  let mockMetrics: jest.Mocked<MetricsCollector>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock instances
    mockMetrics = {
      increment: jest.fn(),
      recordHistogram: jest.fn(),
      gauge: jest.fn(),
    } as any;

    mockMonitoring = {
      metrics: mockMetrics,
      recordHttpRequest: jest.fn(),
      recordDatabaseQuery: jest.fn(),
      recordCacheOperation: jest.fn(),
      recordExternalApiCall: jest.fn(),
      checkHealth: jest.fn(),
    } as any;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Set up mocks
    (MonitoringService as jest.MockedClass<typeof MonitoringService>).mockImplementation(() => mockMonitoring);
    (Logger as jest.MockedClass<typeof Logger>).mockImplementation(() => mockLogger);

    securityMonitor = new SecurityMonitor();
  });

  describe('checkRateLimit', () => {
    it('should allow requests within rate limit', async () => {
      const result = await securityMonitor.checkRateLimit('192.168.1.1', 'api');
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it('should track requests per IP', async () => {
      const ip = '192.168.1.100';
      
      // Make multiple requests
      for (let i = 0; i < 5; i++) {
        const result = await securityMonitor.checkRateLimit(ip, 'api');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(99 - i);
      }
    });

    it('should block requests exceeding rate limit', async () => {
      const ip = '192.168.1.200';
      
      // Simulate exceeding rate limit
      (securityMonitor as any).rateLimitStore.set(ip, {
        count: 100,
        resetAt: new Date(Date.now() + 60000),
      });

      const result = await securityMonitor.checkRateLimit(ip, 'api');
      
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(mockMetrics.increment).toHaveBeenCalledWith(
        'security_events_total',
        1,
        expect.objectContaining({
          event_type: 'rate_limit_exceeded',
        })
      );
    });

    it('should use different limits for different endpoints', async () => {
      const ip = '192.168.1.300';
      
      // API endpoint - 100 requests per minute
      const apiResult = await securityMonitor.checkRateLimit(ip, 'api');
      expect(apiResult.limit).toBe(100);
      
      // Auth endpoint - 10 requests per minute
      const authResult = await securityMonitor.checkRateLimit(ip, 'auth');
      expect(authResult.limit).toBe(10);
      
      // Webhook endpoint - 50 requests per minute
      const webhookResult = await securityMonitor.checkRateLimit(ip, 'webhook');
      expect(webhookResult.limit).toBe(50);
    });

    it('should reset rate limit after window expires', async () => {
      const ip = '192.168.1.400';
      
      // Set expired rate limit
      (securityMonitor as any).rateLimitStore.set(ip, {
        count: 100,
        resetAt: new Date(Date.now() - 1000),
      });

      const result = await securityMonitor.checkRateLimit(ip, 'api');
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
    });
  });

  describe('validateCSRFToken', () => {
    it('should validate matching CSRF tokens', () => {
      const sessionToken = 'valid-csrf-token';
      const requestToken = 'valid-csrf-token';
      
      const result = securityMonitor.validateCSRFToken(sessionToken, requestToken);
      
      expect(result).toBe(true);
    });

    it('should reject mismatched CSRF tokens', () => {
      const sessionToken = 'session-token';
      const requestToken = 'different-token';
      
      const result = securityMonitor.validateCSRFToken(sessionToken, requestToken);
      
      expect(result).toBe(false);
      expect(mockMetrics.increment).toHaveBeenCalledWith(
        'security_events_total',
        1,
        expect.objectContaining({
          event_type: 'csrf_validation_failed',
        })
      );
    });

    it('should reject missing tokens', () => {
      expect(securityMonitor.validateCSRFToken('', 'token')).toBe(false);
      expect(securityMonitor.validateCSRFToken('token', '')).toBe(false);
      expect(securityMonitor.validateCSRFToken('', '')).toBe(false);
    });
  });

  describe('detectSQLInjection', () => {
    it('should detect common SQL injection patterns', () => {
      const maliciousInputs = [
        "'; DROP TABLE users; --",
        "1' OR '1'='1",
        "admin'--",
        "1' UNION SELECT * FROM users--",
        "' OR 1=1--",
        "'; DELETE FROM appointments WHERE '1'='1",
      ];

      maliciousInputs.forEach(input => {
        const result = securityMonitor.detectSQLInjection(input);
        expect(result).toBe(true);
      });

      expect(mockMetrics.increment).toHaveBeenCalledTimes(maliciousInputs.length);
    });

    it('should allow safe inputs', () => {
      const safeInputs = [
        'John Doe',
        'test@example.com',
        '0612345678',
        'Normal street 123',
        'Amsterdam',
        '1234AB',
      ];

      safeInputs.forEach(input => {
        const result = securityMonitor.detectSQLInjection(input);
        expect(result).toBe(false);
      });
    });
  });

  describe('detectXSS', () => {
    it('should detect XSS patterns', () => {
      const xssInputs = [
        '<script>alert("XSS")</script>',
        '<img src=x onerror=alert("XSS")>',
        'javascript:alert("XSS")',
        '<iframe src="javascript:alert()">',
        '<svg onload=alert("XSS")>',
        '"><script>alert()</script>',
      ];

      xssInputs.forEach(input => {
        const result = securityMonitor.detectXSS(input);
        expect(result).toBe(true);
      });

      expect(mockMetrics.increment).toHaveBeenCalledTimes(xssInputs.length);
    });

    it('should allow safe HTML-like content', () => {
      const safeInputs = [
        'Price is < 100',
        'Email: test@example.com',
        'Math: 5 > 3',
        'Code: if (x < y)',
      ];

      safeInputs.forEach(input => {
        const result = securityMonitor.detectXSS(input);
        expect(result).toBe(false);
      });
    });
  });

  describe('logSecurityIncident', () => {
    it('should log high severity incidents', async () => {
      const incident = {
        type: 'sql_injection_attempt',
        severity: 'high' as const,
        ip: '192.168.1.500',
        userAgent: 'Mozilla/5.0',
        requestPath: '/api/booking',
        details: { input: "'; DROP TABLE users; --" },
        blocked: true,
      };

      await securityMonitor.logSecurityIncident(incident);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Security incident detected',
        expect.any(Error),
        expect.objectContaining({
          incident: expect.objectContaining({
            type: 'sql_injection_attempt',
            severity: 'high',
          }),
        })
      );

      expect(mockMetrics.increment).toHaveBeenCalledWith(
        'security_events_total',
        1,
        expect.objectContaining({
          event_type: 'sql_injection_attempt',
          threat_level: 'high',
          blocked: 'true',
        })
      );
    });

    it('should log medium severity incidents', async () => {
      const incident = {
        type: 'rate_limit_exceeded',
        severity: 'medium' as const,
        ip: '192.168.1.600',
        requestPath: '/api/contact',
        blocked: true,
      };

      await securityMonitor.logSecurityIncident(incident);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Security incident detected',
        expect.objectContaining({
          incident,
        })
      );
    });

    it('should log low severity incidents', async () => {
      const incident = {
        type: 'suspicious_activity',
        severity: 'low' as const,
        ip: '192.168.1.700',
        details: { reason: 'Multiple 404 requests' },
        blocked: false,
      };

      await securityMonitor.logSecurityIncident(incident);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Security incident detected',
        expect.objectContaining({
          incident,
        })
      );
    });
  });

  describe('getSecurityMetrics', () => {
    it('should return current security metrics', () => {
      // Set up some incidents
      (securityMonitor as any).recentIncidents = [
        { type: 'sql_injection_attempt', severity: 'high', timestamp: new Date() },
        { type: 'xss_attempt', severity: 'medium', timestamp: new Date() },
        { type: 'rate_limit_exceeded', severity: 'low', timestamp: new Date() },
      ];

      (securityMonitor as any).blockedIPs.add('192.168.1.100');
      (securityMonitor as any).blockedIPs.add('192.168.1.200');

      const metrics = securityMonitor.getSecurityMetrics();

      expect(metrics).toEqual({
        totalIncidents: 3,
        incidentsByType: {
          sql_injection_attempt: 1,
          xss_attempt: 1,
          rate_limit_exceeded: 1,
        },
        incidentsBySeverity: {
          high: 1,
          medium: 1,
          low: 1,
        },
        blockedIPs: 2,
        rateLimitedIPs: 0,
      });
    });

    it('should handle empty metrics', () => {
      const metrics = securityMonitor.getSecurityMetrics();

      expect(metrics).toEqual({
        totalIncidents: 0,
        incidentsByType: {},
        incidentsBySeverity: {},
        blockedIPs: 0,
        rateLimitedIPs: 0,
      });
    });
  });

  describe('cleanupExpiredData', () => {
    it('should remove old incidents', () => {
      const now = Date.now();
      
      // Add old and new incidents
      (securityMonitor as any).recentIncidents = [
        { timestamp: new Date(now - 26 * 60 * 60 * 1000) }, // 26 hours old
        { timestamp: new Date(now - 23 * 60 * 60 * 1000) }, // 23 hours old
        { timestamp: new Date(now - 1 * 60 * 60 * 1000) },  // 1 hour old
      ];

      securityMonitor.cleanupExpiredData();

      expect((securityMonitor as any).recentIncidents).toHaveLength(2);
    });

    it('should remove expired rate limits', () => {
      const now = Date.now();
      
      // Add expired and active rate limits
      (securityMonitor as any).rateLimitStore.set('ip1', {
        count: 100,
        resetAt: new Date(now - 1000),
      });
      (securityMonitor as any).rateLimitStore.set('ip2', {
        count: 50,
        resetAt: new Date(now + 1000),
      });

      securityMonitor.cleanupExpiredData();

      expect((securityMonitor as any).rateLimitStore.has('ip1')).toBe(false);
      expect((securityMonitor as any).rateLimitStore.has('ip2')).toBe(true);
    });
  });
});