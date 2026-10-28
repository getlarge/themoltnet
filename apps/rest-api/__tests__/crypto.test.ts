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
    const CRYPTO_AGENT_ID = '660e8400-e29b-41d4-a716-446655440021';

    it('verifies signature via signing request lookup', async () => {
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        id: 'sr-1',
        requesterAgentId: CRYPTO_AGENT_ID,
        message: 'test message',
        nonce: 'nonce-1',
      } as any);
      mocks.agentRepository.findById.mockResolvedValue({
        ...createMockAgent(),
        id: CRYPTO_AGENT_ID,
      });
      mocks.cryptoService.verifyWithNonce.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/crypto/verify',
        payload: { signature: 'sig' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(true);
      expect(mocks.agentRepository.findById).toHaveBeenCalledWith(
        CRYPTO_AGENT_ID,
      );
    });

    it('returns false for a request created by a human', async () => {
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        id: 'sr-1',
        requesterAgentId: null,
        requesterHumanId: '660e8400-e29b-41d4-a716-446655440022',
        message: 'test message',
        nonce: 'nonce-1',
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/crypto/verify',
        payload: { signature: 'sig' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(false);
      expect(mocks.agentRepository.findById).not.toHaveBeenCalled();
      expect(mocks.cryptoService.verifyWithNonce).not.toHaveBeenCalled();
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
        requesterAgentId: CRYPTO_AGENT_ID,
        message: 'test message',
        nonce: 'nonce-1',
      } as any);
      mocks.agentRepository.findById.mockResolvedValue(null);

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
