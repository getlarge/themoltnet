import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  type MockServices,
  resetMockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

describe('Crypto routes', () => {
  let mocks: MockServices;
  let app: FastifyInstance;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
  });

  describe('POST /crypto/verify', () => {
    it('verifies signature via signing request lookup', async () => {
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        id: 'sr-1',
        agentId: 'agent-1',
        message: 'test message',
        nonce: 'nonce-1',
      } as any);
      mocks.agentRepository.findByIdentityId.mockResolvedValue({
        ...createMockAgent(),
        identityId: 'agent-1',
      });
      mocks.cryptoService.verifyWithNonce.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/crypto/verify',
        payload: { signature: 'sig' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(true);
    });

    it('returns false when signature not found', async () => {
      mocks.signingRequestRepository.findBySignature.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/crypto/verify',
        payload: { signature: 'missing' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(false);
    });

    it('returns false when agent not found', async () => {
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        id: 'sr-1',
        agentId: 'agent-1',
        message: 'test message',
        nonce: 'nonce-1',
      } as any);
      mocks.agentRepository.findByIdentityId.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/crypto/verify',
        payload: { signature: 'sig' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(false);
      expect(mocks.cryptoService.verifyWithNonce).not.toHaveBeenCalled();
    });

    it('returns 400 for missing signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/crypto/verify',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /crypto/identity', () => {
    it('reports the stored key, not the one in the token claims', async () => {
      const identityApp = await createTestApp(mocks, VALID_AUTH_CONTEXT);
      try {
        mocks.agentRepository.findById.mockResolvedValue(
          createMockAgent({
            publicKey: 'ed25519:rotated',
            fingerprint: 'B0B0-0000-0000-0001',
          }),
        );

        const response = await identityApp.inject({
          method: 'GET',
          url: '/crypto/identity',
          headers: { authorization: 'Bearer test-token' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          publicKey: 'ed25519:rotated',
          fingerprint: 'B0B0-0000-0000-0001',
        });
        expect(mocks.agentRepository.findById).toHaveBeenCalledWith(
          VALID_AUTH_CONTEXT.agentId,
        );
      } finally {
        await identityApp.close();
      }
    });
  });
});
