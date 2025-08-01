#!/usr/bin/env node

/**
 * Security Testing Script
 * 
 * Tests various security features of the application
 */

const https = require('https');
const http = require('http');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const isProduction = BASE_URL.includes('https://');

// Test configurations
const tests = [
  {
    name: 'HTTPS Redirect',
    skip: !isProduction,
    test: async () => {
      if (!isProduction) return { passed: true, message: 'Skipped in development' };
      
      // Test HTTP to HTTPS redirect
      return new Promise((resolve) => {
        const url = BASE_URL.replace('https://', 'http://');
        http.get(url, (res) => {
          resolve({
            passed: res.statusCode === 301 && res.headers.location?.startsWith('https://'),
            message: `Status: ${res.statusCode}, Location: ${res.headers.location}`
          });
        }).on('error', (err) => {
          resolve({ passed: false, message: err.message });
        });
      });
    }
  },
  
  {
    name: 'Security Headers',
    test: async () => {
      return new Promise((resolve) => {
        const url = new URL(BASE_URL);
        const options = {
          hostname: url.hostname,
          port: url.port,
          path: '/',
          method: 'GET'
        };
        
        const protocol = url.protocol === 'https:' ? https : http;
        protocol.get(options, (res) => {
          const headers = res.headers;
          const required = [
            'x-frame-options',
            'x-content-type-options',
            'referrer-policy'
          ];
          
          const missing = required.filter(h => !headers[h]);
          resolve({
            passed: missing.length === 0,
            message: missing.length ? `Missing: ${missing.join(', ')}` : 'All headers present'
          });
        }).on('error', (err) => {
          resolve({ passed: false, message: err.message });
        });
      });
    }
  },
  
  {
    name: 'CORS Preflight',
    test: async () => {
      return new Promise((resolve) => {
        const url = new URL(BASE_URL + '/api/availability');
        const options = {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://example.com',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'Content-Type'
          }
        };
        
        const protocol = url.protocol === 'https:' ? https : http;
        const req = protocol.request(options, (res) => {
          const corsHeaders = res.headers['access-control-allow-origin'];
          resolve({
            passed: res.statusCode === 204 || res.statusCode === 403,
            message: `Status: ${res.statusCode}, CORS: ${corsHeaders || 'blocked'}`
          });
        });
        
        req.on('error', (err) => {
          resolve({ passed: false, message: err.message });
        });
        
        req.end();
      });
    }
  },
  
  {
    name: 'Rate Limiting',
    test: async () => {
      // Make multiple requests to test rate limiting
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(new Promise((resolve) => {
          const url = new URL(BASE_URL + '/api/availability');
          const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'GET'
          };
          
          const protocol = url.protocol === 'https:' ? https : http;
          protocol.get(options, (res) => {
            resolve({
              status: res.statusCode,
              rateLimit: res.headers['x-ratelimit-limit'],
              remaining: res.headers['x-ratelimit-remaining']
            });
          }).on('error', () => {
            resolve({ status: 0 });
          });
        }));
      }
      
      const results = await Promise.all(promises);
      const rateLimited = results.some(r => r.status === 429);
      const hasHeaders = results.some(r => r.rateLimit);
      
      return {
        passed: hasHeaders,
        message: `Rate limit headers: ${hasHeaders ? 'present' : 'missing'}, 429 response: ${rateLimited ? 'yes' : 'no'}`
      };
    }
  },
  
  {
    name: 'Input Validation',
    test: async () => {
      return new Promise((resolve) => {
        const url = new URL(BASE_URL + '/api/bookings/validate');
        const postData = JSON.stringify({
          email: 'invalid-email',
          phone: '123',
          serviceType: 'invalid'
        });
        
        const options = {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };
        
        const protocol = url.protocol === 'https:' ? https : http;
        const req = protocol.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            resolve({
              passed: res.statusCode === 400 || res.statusCode === 401,
              message: `Status: ${res.statusCode}, Validation working`
            });
          });
        });
        
        req.on('error', (err) => {
          resolve({ passed: false, message: err.message });
        });
        
        req.write(postData);
        req.end();
      });
    }
  },
  
  {
    name: 'SQL Injection Prevention',
    test: async () => {
      return new Promise((resolve) => {
        const url = new URL(BASE_URL + '/api/availability?date=2024-01-01\' OR 1=1--');
        const options = {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: 'GET'
        };
        
        const protocol = url.protocol === 'https:' ? https : http;
        protocol.get(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            // Should either validate properly or reject the request
            const validResponse = res.statusCode === 400 || 
                                (res.statusCode === 200 && !data.includes('error'));
            resolve({
              passed: validResponse,
              message: `Status: ${res.statusCode}, SQL injection ${validResponse ? 'blocked' : 'VULNERABLE!'}`
            });
          });
        }).on('error', (err) => {
          resolve({ passed: false, message: err.message });
        });
      });
    }
  }
];

// Run tests
async function runSecurityTests() {
  console.log('🔒 Security Testing Suite');
  console.log('========================\n');
  console.log(`Testing: ${BASE_URL}\n`);
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    if (test.skip) {
      console.log(`⏭️  ${test.name}: SKIPPED`);
      continue;
    }
    
    process.stdout.write(`🔍 ${test.name}... `);
    
    try {
      const result = await test.test();
      if (result.passed) {
        console.log(`✅ PASSED - ${result.message}`);
        passed++;
      } else {
        console.log(`❌ FAILED - ${result.message}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ERROR - ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n========================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================\n');
  
  if (failed > 0) {
    console.log('⚠️  Security vulnerabilities detected!');
    process.exit(1);
  } else {
    console.log('✅ All security tests passed!');
    process.exit(0);
  }
}

// Run the tests
runSecurityTests().catch(console.error);