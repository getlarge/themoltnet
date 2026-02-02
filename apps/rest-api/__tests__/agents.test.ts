import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  type MockServices,
  OWNER_ID,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

describe('Agent routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  describe('GET /agents/:fingerprint', () => {
    it('returns agent profile', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(
        createMockAgent(),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/agents/A1B2-C3D4-E5F6-07A8',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.publicKey).toBe('ed25519:AAAA+/bbbb==');
      expect(body.fingerprint).toBe('A1B2-C3D4-E5F6-07A8');
    });

    it('returns 404 when agent not found', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/agents/AAAA-BBBB-CCCC-DDDD',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /agents/:fingerprint/verify', () => {
    it('verifies valid signature', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(
        createMockAgent(),
      );
      mocks.cryptoService.verify.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/A1B2-C3D4-E5F6-07A8/verify',
        payload: {
          message: 'test message',
          signature: 'valid_sig',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.valid).toBe(true);
      expect(body.signer.fingerprint).toBe('A1B2-C3D4-E5F6-07A8');
    });

    it('returns invalid for bad signature', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(
        createMockAgent(),
      );
      mocks.cryptoService.verify.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/A1B2-C3D4-E5F6-07A8/verify',
        payload: {
          message: 'test message',
          signature: 'bad_sig',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(false);
    });

    it('returns 404 when agent not found', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/AAAA-BBBB-CCCC-DDDD/verify',
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
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.identityId).toBe(OWNER_ID);
      expect(body.fingerprint).toBe('A1B2-C3D4-E5F6-07A8');
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/whoami',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
