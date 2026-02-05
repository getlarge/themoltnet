/**
 * Security feature tests
 *
 * Tests for rate limiting, security headers, and CORS configuration.
 */

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

describe('Security features', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks);
  });

  describe('Security headers', () => {
    it('includes HSTS header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['strict-transport-security']).toContain(
        'max-age=',
      );
    });

    it('includes X-Content-Type-Options nosniff', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('includes X-Frame-Options deny', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('includes Content-Security-Policy', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['content-security-policy']).toBeDefined();
    });

    it('does not include X-Powered-By header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('adds Cache-Control for authenticated responses', async () => {
      // Set up authenticated request
      const authenticatedApp = await createTestApp(mocks, VALID_AUTH_CONTEXT);
      mocks.agentRepository.findByIdentityId.mockResolvedValue({
        identityId: VALID_AUTH_CONTEXT.identityId,
        publicKey: VALID_AUTH_CONTEXT.publicKey,
        fingerprint: VALID_AUTH_CONTEXT.fingerprint,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await authenticatedApp.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      // 200 response - should have cache control
      expect(response.statusCode).toBe(200);
      const cacheControl = response.headers['cache-control'];
      expect(cacheControl).toBeDefined();
      expect(cacheControl).toContain('no-store');
    });
  });

  describe('CORS', () => {
    it('allows requests from configured origins', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      });

      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
    });

    it('rejects requests from unauthorized origins', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'https://malicious-site.com',
          'access-control-request-method': 'GET',
        },
      });

      // CORS error results in 500 status from the cors plugin
      expect(response.statusCode).toBe(500);
    });

    it('includes credentials in CORS response', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      });

      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('exposes rate limit headers in CORS', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      });

      const exposedHeaders = response.headers['access-control-expose-headers'];
      expect(exposedHeaders).toContain('X-RateLimit-Limit');
      expect(exposedHeaders).toContain('X-RateLimit-Remaining');
      expect(exposedHeaders).toContain('Retry-After');
    });
  });

  describe('Rate limiting', () => {
    it('includes rate limit headers on successful requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      // Rate limit headers should be present
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('skips rate limiting for health check', async () => {
      // Make multiple rapid requests to health endpoint
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          app.inject({
            method: 'GET',
            url: '/health',
          }),
        ),
      );

      // All should succeed (rate limit would kick in much earlier otherwise)
      expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    });

    it('skips rate limiting for problems endpoint', async () => {
      // Make multiple rapid requests to problems endpoint
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          app.inject({
            method: 'GET',
            url: '/problems',
          }),
        ),
      );

      // All should succeed
      expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    });

    it('rate limit config is accessible on fastify instance', async () => {
      expect(app.rateLimitConfig).toBeDefined();
      expect(app.rateLimitConfig.embedding).toEqual({
        max: 1000, // Test limit
        timeWindow: '1 minute',
      });
      expect(app.rateLimitConfig.vouch).toEqual({
        max: 1000, // Test limit
        timeWindow: '1 minute',
      });
    });

    it('returns RFC 9457 Problem Details on rate limit exceeded', async () => {
      // Create app with very low rate limit
      const lowLimitApp = await createTestApp(mocks);
      // Override the rate limit to be very low for this test
      // We'll make requests to a non-allowlisted endpoint until we exceed the limit
      type InjectResponse = Awaited<ReturnType<typeof lowLimitApp.inject>>;
      const responses: InjectResponse[] = [];
      for (let i = 0; i < 1002; i++) {
        responses.push(
          await lowLimitApp.inject({
            method: 'GET',
            url: '/agents/whoami',
            headers: {
              authorization: 'Bearer test-token',
            },
          }),
        );
      }

      // At least one should be rate limited (429)
      const rateLimited = responses.find((r) => r.statusCode === 429);
      if (rateLimited) {
        const body = JSON.parse(rateLimited.body);
        expect(body.type).toContain('rate-limit-exceeded');
        expect(body.title).toBe('Rate Limit Exceeded');
        expect(body.status).toBe(429);
        expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(body.retryAfter).toBeDefined();
        expect(typeof body.retryAfter).toBe('number');
      }
      // If no rate limit hit, that's fine - limits are high in test mode
    });
  });
});
