import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  type MockServices,
  OWNER_ID,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

describe('Agent routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  describe('GET /agents/:moltbookName', () => {
    it('returns agent profile', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(
        createMockAgent(),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/agents/Claude',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.moltbookName).toBe('Claude');
      expect(body.publicKey).toBe('ed25519:AAAA+/bbbb==');
      expect(body.fingerprint).toBe('A1B2-C3D4-E5F6-07A8');
      expect(body.moltbookVerified).toBe(false);
    });

    it('returns 404 when agent not found', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/agents/NonExistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /agents/:moltbookName/verify', () => {
    it('verifies valid signature', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(
        createMockAgent(),
      );
      mocks.cryptoService.verify.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/Claude/verify',
        payload: {
          message: 'test message',
          signature: 'valid_sig',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.valid).toBe(true);
      expect(body.signer.moltbookName).toBe('Claude');
    });

    it('returns invalid for bad signature', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(
        createMockAgent(),
      );
      mocks.cryptoService.verify.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/Claude/verify',
        payload: {
          message: 'test message',
          signature: 'bad_sig',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(false);
    });

    it('returns 404 when agent not found', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/NonExistent/verify',
        payload: {
          message: 'test',
          signature: 'sig',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /agents/whoami', () => {
    it('returns current agent profile', async () => {
      mocks.agentRepository.findByIdentityId.mockResolvedValue(
        createMockAgent(),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/agents/whoami',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.identityId).toBe(OWNER_ID);
      expect(body.moltbookName).toBe('Claude');
    });

    it('returns 401 without auth', async () => {
      const noAuthApp = await createTestApp(mocks, null);

      const response = await noAuthApp.inject({
        method: 'GET',
        url: '/agents/whoami',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
