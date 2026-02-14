import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
} from './helpers.js';

describe('Status routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /status', () => {
    it('returns JSON with service statuses when Accept: application/json', async () => {
      // Arrange — mock fetch to simulate all services being up
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));

      // Act
      const response = await app.inject({
        method: 'GET',
        url: '/status',
        headers: { accept: 'application/json' },
      });

      // Assert
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.overall).toBe('healthy');
      expect(body.timestamp).toBeDefined();
      expect(body.services).toHaveLength(3);
      expect(body.services[0].name).toBe('REST API');
      expect(body.services[1].name).toBe('MCP Server');
      expect(body.services[2].name).toBe('Landing Page');
      for (const service of body.services) {
        expect(service.status).toBe('up');
        expect(service.responseMs).toBeTypeOf('number');
      }
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('returns HTML by default', async () => {
      // Arrange
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200 }),
      );

      // Act
      const response = await app.inject({
        method: 'GET',
        url: '/status',
      });

      // Assert
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('MoltNet Status');
      expect(response.body).toContain('HEALTHY');
    });

    it('reports degraded when some services are down', async () => {
      // Arrange — first service up, rest down
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('ok', { status: 200 }))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      // Act
      const response = await app.inject({
        method: 'GET',
        url: '/status',
        headers: { accept: 'application/json' },
      });

      // Assert
      const body = response.json();
      expect(body.overall).toBe('degraded');
      expect(body.services[0].status).toBe('up');
      expect(body.services[1].status).toBe('down');
      expect(body.services[1].error).toBe('Connection refused');
      expect(body.services[2].status).toBe('up');
    });

    it('reports down when all services are unreachable', async () => {
      // Arrange
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('Network error'),
      );

      // Act
      const response = await app.inject({
        method: 'GET',
        url: '/status',
        headers: { accept: 'application/json' },
      });

      // Assert
      const body = response.json();
      expect(body.overall).toBe('down');
      for (const service of body.services) {
        expect(service.status).toBe('down');
      }
    });

    it('reports down for non-OK HTTP responses', async () => {
      // Arrange
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Internal Server Error', { status: 500 }),
      );

      // Act
      const response = await app.inject({
        method: 'GET',
        url: '/status',
        headers: { accept: 'application/json' },
      });

      // Assert
      const body = response.json();
      expect(body.overall).toBe('down');
      for (const service of body.services) {
        expect(service.status).toBe('down');
        expect(service.error).toBe('HTTP 500');
      }
    });
  });
});
