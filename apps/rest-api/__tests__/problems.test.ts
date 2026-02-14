import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { problemTypes } from '../src/problems/registry.js';
import {
  createMockServices,
  createTestApp,
  type MockServices,
} from './helpers.js';

describe('Problem type documentation routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks);
  });

  describe('GET /problems', () => {
    it('returns all problem types as JSON array', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/problems',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(10);

      const first = body[0];
      expect(first).toHaveProperty('type');
      expect(first).toHaveProperty('title');
      expect(first).toHaveProperty('status');
      expect(first).toHaveProperty('code');
      expect(first).toHaveProperty('description');
      expect(first).toHaveProperty('commonCauses');
      expect(first.type).toMatch(/^https:\/\/themolt\.net\/problems\//);
    });

    it('does not require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/problems',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /problems/:type', () => {
    it('returns a single problem type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/problems/unauthorized',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.status).toBe(401);
      expect(body.type).toBe('https://themolt.net/problems/unauthorized');
    });

    it('returns 400 for unknown problem type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/problems/nonexistent',
      });

      expect(response.statusCode).toBe(400);
    });
  });
});

describe('Problem type registry', () => {
  it('includes serialization-exhausted problem type', () => {
    expect(problemTypes['serialization-exhausted']).toEqual({
      slug: 'serialization-exhausted',
      code: 'SERIALIZATION_EXHAUSTED',
      status: 429,
      title: 'Serialization Retry Exhausted',
      description:
        'Concurrent request conflict could not be resolved after retries.',
      commonCauses: [
        'Too many concurrent writes to the same resource',
        'Try again after a short delay',
      ],
    });
  });
});
