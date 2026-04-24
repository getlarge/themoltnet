import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  errorHandlerPlugin,
  extractPgErrorFields,
} from '../src/plugins/error-handler.js';
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
      headers: { accept: 'application/problem+json' },
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
      headers: { accept: 'application/problem+json' },
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
      headers: { accept: 'application/problem+json' },
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

  it('falls back to application/json when client does not accept problem+json', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/test-not-found',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-type']).not.toContain('problem');
    const body = response.json();
    expect(body.code).toBe('NOT_FOUND');
    expect(body.type).toBe('https://themolt.net/problems/not-found');
  });

  it('maps Fastify schema validation errors to VALIDATION_FAILED', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/test-schema',
      payload: {},
      headers: { accept: 'application/problem+json' },
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

describe('extractPgErrorFields', () => {
  it('returns null for plain errors without a pg SQLSTATE', () => {
    expect(extractPgErrorFields(new Error('boom'))).toBeNull();
    expect(extractPgErrorFields(null)).toBeNull();
    expect(extractPgErrorFields({ code: 'FST_ERR_VALIDATION' })).toBeNull();
  });

  it('extracts SQLSTATE and constraint from a bare pg error', () => {
    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'task_messages_pkey',
      table: 'task_messages',
      column: undefined,
      schema: 'public',
      routine: '_bt_check_unique',
    });

    expect(extractPgErrorFields(pgErr)).toEqual({
      pg_code: '23505',
      pg_constraint: 'task_messages_pkey',
      pg_table: 'task_messages',
      pg_column: undefined,
      pg_schema: 'public',
      pg_routine: '_bt_check_unique',
    });
  });

  it('unwraps the pg error from DrizzleQueryError.cause', () => {
    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'task_messages_pkey',
      table: 'task_messages',
    });
    // DrizzleQueryError is a plain Error whose `cause` points at the pg error.
    // We only care that the walker follows `.cause` until it finds a
    // SQLSTATE-shaped code.
    const drizzleErr = Object.assign(new Error('Failed query'), {
      code: 'DRIZZLE_QUERY_ERROR',
      cause: pgErr,
    });

    const fields = extractPgErrorFields(drizzleErr);
    expect(fields?.pg_code).toBe('23505');
    expect(fields?.pg_constraint).toBe('task_messages_pkey');
    expect(fields?.pg_table).toBe('task_messages');
  });

  it('does not loop on circular cause chains', () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = { cause: a };
    a.cause = b;
    expect(extractPgErrorFields(a)).toBeNull();
  });
});
