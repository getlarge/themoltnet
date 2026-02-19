import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  type MockServices,
  OTHER_AGENT_ID,
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
        url: '/agents/C212-DAFA-27C5-6C57',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.publicKey).toBe(
        'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
      );
      expect(body.fingerprint).toBe('C212-DAFA-27C5-6C57');
    });

    it('returns 404 when agent not found', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/agents/AAAA-BBBB-CCCC-DDDD',
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /agents/:fingerprint/verify', () => {
    it('verifies valid signature', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(
        createMockAgent(),
      );
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        id: 'sr-1',
        agentId: OWNER_ID,
        message: 'test message',
        nonce: 'nonce-1',
      } as any);
      mocks.cryptoService.verifyWithNonce.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/C212-DAFA-27C5-6C57/verify',
        payload: {
          signature: 'valid_sig',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.valid).toBe(true);
      expect(body.signer.fingerprint).toBe('C212-DAFA-27C5-6C57');
      expect(
        mocks.signingRequestRepository.findBySignature,
      ).toHaveBeenCalledWith('valid_sig');
    });

    it('returns invalid for bad signature', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(
        createMockAgent(),
      );
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        id: 'sr-1',
        agentId: OWNER_ID,
        message: 'test message',
        nonce: 'nonce-1',
      } as any);
      mocks.cryptoService.verifyWithNonce.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/C212-DAFA-27C5-6C57/verify',
        payload: {
          signature: 'bad_sig',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(false);
      expect(
        mocks.signingRequestRepository.findBySignature,
      ).toHaveBeenCalledWith('bad_sig');
    });

    it('returns invalid when signature belongs to another agent', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(
        createMockAgent(),
      );
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        id: 'sr-2',
        agentId: OTHER_AGENT_ID,
        message: 'test message',
        nonce: 'nonce-2',
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/C212-DAFA-27C5-6C57/verify',
        payload: {
          signature: 'sig',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(false);
      expect(mocks.cryptoService.verifyWithNonce).not.toHaveBeenCalled();
    });

    it('returns 404 when agent not found', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/agents/AAAA-BBBB-CCCC-DDDD/verify',
        payload: {
          signature: 'sig',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
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
      expect(body.fingerprint).toBe('C212-DAFA-27C5-6C57');
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/whoami',
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });
});
