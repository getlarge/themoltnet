import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
} from './helpers.js';

describe('Health routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, null);
  });

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('GET /health/ready', () => {
    it('returns degraded when dependencies are not configured', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(response.statusCode).toBe(503);
      const body = response.json();
      expect(body.status).toBe('degraded');
      expect(body.timestamp).toBeDefined();
      expect(body.components.database).toEqual({
        status: 'error',
        latencyMs: 0,
        error: 'Not configured',
      });
      expect(body.components.ory).toEqual({
        status: 'error',
        latencyMs: 0,
        error: 'Not configured',
      });
    });
  });
});

describe('Health readiness probes', () => {
  let mocks: MockServices;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks = createMockServices();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('returns ok when all probes succeed', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    };
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const app = await createTestApp(mocks, null, undefined, {
      pool: mockPool,
      oryProjectUrl: 'https://mock-ory.example.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.components.database.status).toBe('ok');
    expect(body.components.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.components.ory.status).toBe('ok');
    expect(body.components.ory.latencyMs).toBeGreaterThanOrEqual(0);
    expect(mockPool.query).toHaveBeenCalledWith('SELECT 1');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://mock-ory.example.com/.well-known/openid-configuration',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns degraded when database probe fails', async () => {
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const app = await createTestApp(mocks, null, undefined, {
      pool: mockPool,
      oryProjectUrl: 'https://mock-ory.example.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.components.database.status).toBe('error');
    expect(body.components.database.error).toBe('connection refused');
    expect(body.components.ory.status).toBe('ok');
  });

  it('returns degraded when Ory probe returns non-200', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    };
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 503 }));

    const app = await createTestApp(mocks, null, undefined, {
      pool: mockPool,
      oryProjectUrl: 'https://mock-ory.example.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.components.database.status).toBe('ok');
    expect(body.components.ory.status).toBe('error');
    expect(body.components.ory.error).toBe('HTTP 503');
  });

  it('returns degraded when Ory probe throws network error', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    };
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));

    const app = await createTestApp(mocks, null, undefined, {
      pool: mockPool,
      oryProjectUrl: 'https://mock-ory.example.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.components.database.status).toBe('ok');
    expect(body.components.ory.status).toBe('error');
    expect(body.components.ory.error).toBe('fetch failed');
  });
});
