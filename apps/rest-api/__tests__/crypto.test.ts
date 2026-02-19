import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  type MockServices,
} from './helpers.js';

describe('Crypto routes', () => {
  let mocks: MockServices;
  let app: FastifyInstance;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks);
  });

  afterEach(async () => {
    await app.close();
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
});
