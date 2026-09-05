import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  HUMAN_AUTH_CONTEXT,
  KEY_AUTH_CONTEXT,
  type MockServices,
  OTHER_AGENT_ID,
  OWNER_ID,
  OWNER_IDENTITY_ID,
  resetMockServices,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

describe('Agent routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
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
      expect(response.headers['content-type']).toContain('application/json');
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
        // `signing_requests.agent_id` stores a Kratos identity, not agents.id:
        // the column carries no foreign key, so migration 0041's FK-driven
        // rewrite never reached it. Retargeting it needs its own migration.
        agentId: OWNER_IDENTITY_ID,
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
      expect(response.headers['content-type']).toContain('application/json');
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /agents/whoami', () => {
    it('returns current agent identity with subjectType and currentTeamId', async () => {
      mocks.agentRepository.findById.mockResolvedValue(createMockAgent());

      const response = await app.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // principalId is agents.id — the durable one. identityId is the Kratos
      // binding this request authenticated as.
      expect(body.principalId).toBe(OWNER_ID);
      expect(body.identityId).toBe(OWNER_IDENTITY_ID);
      expect(body.fingerprint).toBe('C212-DAFA-27C5-6C57');
      expect(body.subjectType).toBe('agent');
      expect(body.scopes).toEqual(VALID_AUTH_CONTEXT.scopes);
      expect(body).toHaveProperty('currentTeamId');
      expect(body).not.toHaveProperty('credentialBinding');
    });

    it('includes credentialBinding when authenticated via an agent key', async () => {
      const keyApp = await createTestApp(mocks, KEY_AUTH_CONTEXT);
      mocks.agentRepository.findById.mockResolvedValue(createMockAgent());

      const response = await keyApp.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().credentialBinding).toEqual({
        bindingScope: 'team',
        keyId: 'key-123',
        boundTeamId: OWNER_ID,
      });
      await keyApp.close();
    });

    it('returns the identity discriminator without a boundTeamId', async () => {
      const keyApp = await createTestApp(mocks, {
        ...KEY_AUTH_CONTEXT,
        credentialBinding: {
          bindingScope: 'identity',
          keyId: 'identity-key-123',
        },
      });
      mocks.agentRepository.findById.mockResolvedValue(createMockAgent());

      const response = await keyApp.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().credentialBinding).toEqual({
        bindingScope: 'identity',
        keyId: 'identity-key-123',
      });
      await keyApp.close();
    });

    it('returns a human identity without a 403', async () => {
      const humanApp = await createTestApp(mocks, HUMAN_AUTH_CONTEXT);

      const response = await humanApp.inject({
        method: 'GET',
        url: '/agents/whoami',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // principalId is humans.id (the FK target and Keto subject);
      // identityId is the Kratos binding. Distinct values on purpose.
      expect(body.principalId).toBe(OWNER_ID);
      expect(body.identityId).toBe(OWNER_IDENTITY_ID);
      expect(body.subjectType).toBe('human');
      expect(body.scopes).toEqual(HUMAN_AUTH_CONTEXT.scopes);
      expect(body).not.toHaveProperty('publicKey');
      await humanApp.close();
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/whoami',
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain('application/json');
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });
});
