import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { errorHandlerPlugin } from '../src/plugins/error-handler.js';
import {
  createProblem,
  createValidationProblem,
} from '../src/problems/index.js';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);

  app.get('/test-not-found', async () => {
    throw createProblem('not-found', 'Test resource not found');
  });

  app.get('/test-validation', async () => {
    throw createValidationProblem([{ field: 'name', message: 'Required' }]);
  });

  app.get('/test-crash', async () => {
    throw new Error('Something broke');
  });

  app.post(
    '/test-schema',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
    },
    async () => ({ ok: true }),
  );

  return app;
}

describe('Error handler plugin', () => {
  it('returns RFC 9457 for problem errors', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/test-not-found',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json();
    expect(body).toMatchObject({
      type: 'https://themolt.net/problems/not-found',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Test resource not found',
      instance: '/test-not-found',
    });
  });

  it('returns RFC 9457 with errors array for validation problems', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/test-validation',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors).toEqual([{ field: 'name', message: 'Required' }]);
  });

  it('returns RFC 9457 for unexpected errors (5xx)', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/test-crash',
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json();
    expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.type).toBe(
      'https://themolt.net/problems/internal-server-error',
    );
    // Should NOT leak the original error message
    expect(body.detail).not.toBe('Something broke');
  });

  it('tags unexpected errors (no statusCode) as unhandled in the response', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/test-crash',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    // The detail should be sanitized — no leak of "Something broke"
    expect(body.detail).toBe('An unexpected error occurred');
  });

  it('preserves statusCode and code for known problem errors', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/test-not-found',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
    expect(response.json().detail).toBe('Test resource not found');
  });

  it('maps Fastify schema validation errors to VALIDATION_FAILED', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/test-schema',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });
});
