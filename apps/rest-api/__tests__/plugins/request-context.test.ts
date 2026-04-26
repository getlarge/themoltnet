/**
 * Tests for the request-context Fastify plugin.
 *
 * Verifies that:
 * - requestId is set in ALS on every request
 * - identityId/clientId are enriched after auth
 * - unauthenticated requests don't crash
 */

import '@moltnet/auth'; // pulls in FastifyRequest.authContext module augmentation

import { getRequestContextFields } from '@moltnet/observability';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestContextPlugin } from '../../src/plugins/request-context.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(
  authContext?: {
    identityId?: string;
    clientId?: string;
  } | null,
) {
  const app = Fastify({ logger: false });

  // Simulate the authPlugin decorator: decorate authContext on request
  app.decorateRequest('authContext', null);

  app.register(requestContextPlugin);

  // Route that reads ALS context fields directly and returns them
  app.get('/test', async (request) => {
    const fields = getRequestContextFields();
    return { fields, requestId: request.id };
  });

  // Optional hook that sets authContext before preHandler runs
  if (authContext !== undefined) {
    app.addHook('onRequest', async (request) => {
      // Simulate auth middleware populating authContext after token validation
      request.authContext = authContext as typeof request.authContext;
    });
  }

  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requestContextPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requestId propagation', () => {
    it('sets requestId in ALS context for every request', async () => {
      // Arrange
      const app = buildApp();

      // Act
      const response = await app.inject({ method: 'GET', url: '/test' });

      // Assert
      const body = JSON.parse(response.body) as {
        fields: Record<string, unknown>;
        requestId: string;
      };
      expect(response.statusCode).toBe(200);
      expect(body.fields.requestId).toBe(body.requestId);
    });
  });

  // Auth context enrichment lives in the auth plugin (libs/auth), not
  // here — global preHandlers run before route-scoped requireAuth, so
  // request.authContext is always null at that point. Coverage is in
  // `libs/auth/__tests__/plugin.test.ts` ("enriches request.log + ALS
  // context after authenticating") and the pino integration test.
});
