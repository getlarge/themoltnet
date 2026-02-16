import { cryptoService } from '@moltnet/crypto-service';
import type { FastifyInstance } from 'fastify';
import type { vi } from 'vitest';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createMockVoucher,
  createTestApp,
  type MockServices,
  OWNER_ID,
  TEST_WEBHOOK_API_KEY,
} from './helpers.js';

describe('Hook routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    // Hooks don't require auth (they're called by Ory services)
    app = await createTestApp(mocks, null);
  });

  describe('POST /hooks/kratos/after-registration', () => {
    const testPublicKey =
      'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=';
    const expectedFingerprint = cryptoService.generateFingerprint(
      cryptoService.parsePublicKey(testPublicKey),
    );

    const validPayload = {
      identity: {
        id: OWNER_ID,
        traits: {
          public_key: testPublicKey,
          voucher_code: 'a'.repeat(64),
        },
      },
    };

    it('creates agent entry when voucher is valid', async () => {
      mocks.voucherRepository.redeem.mockResolvedValue(createMockVoucher());
      mocks.agentRepository.upsert.mockResolvedValue(createMockAgent());
      mocks.relationshipWriter.registerAgent.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.identity.metadata_public).toEqual({
        fingerprint: expectedFingerprint,
        public_key: testPublicKey,
      });
      expect(mocks.transactionRunner.runInTransaction).toHaveBeenCalledWith(
        expect.any(Function),
        { name: 'hooks.after-registration' },
      );
      expect(mocks.voucherRepository.redeem).toHaveBeenCalledWith(
        'a'.repeat(64),
        OWNER_ID,
      );
      expect(mocks.agentRepository.upsert).toHaveBeenCalledWith({
        identityId: OWNER_ID,
        publicKey: testPublicKey,
        fingerprint: expectedFingerprint,
      });
      expect(mocks.relationshipWriter.registerAgent).toHaveBeenCalledWith(
        OWNER_ID,
      );
    });

    it('rejects registration with invalid voucher (Ory error format)', async () => {
      mocks.voucherRepository.redeem.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].instance_ptr).toBe('#/traits/voucher_code');
      expect(body.messages[0].messages[0].id).toBe(4000003);
      expect(body.messages[0].messages[0].type).toBe('error');
      expect(mocks.agentRepository.upsert).not.toHaveBeenCalled();
      expect(mocks.relationshipWriter.registerAgent).not.toHaveBeenCalled();
    });

    it('rolls back transaction when Keto registration fails', async () => {
      mocks.voucherRepository.redeem.mockResolvedValue(createMockVoucher());
      mocks.agentRepository.upsert.mockResolvedValue(createMockAgent());
      mocks.relationshipWriter.registerAgent.mockRejectedValue(
        new Error('Keto unavailable'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(500);
      expect(mocks.voucherRepository.redeem).toHaveBeenCalled();
      expect(mocks.agentRepository.upsert).toHaveBeenCalled();
    });

    it('rejects registration with invalid public_key format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              public_key: 'rsa:not-an-ed25519-key',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].instance_ptr).toBe('#/traits/public_key');
      expect(body.messages[0].messages[0].id).toBe(4000001);
      expect(body.messages[0].messages[0].text).toContain('32 bytes');
      expect(mocks.voucherRepository.redeem).not.toHaveBeenCalled();
    });
  });

  describe('POST /hooks/kratos/after-settings', () => {
    it('updates agent entry', async () => {
      mocks.agentRepository.upsert.mockResolvedValue(
        createMockAgent({
          publicKey: 'ed25519:bW9sdG5ldC10ZXN0LWtleS0yLWZvci11bml0LXRlc3Q=',
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-settings',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              public_key:
                'ed25519:bW9sdG5ldC10ZXN0LWtleS0yLWZvci11bml0LXRlc3Q=',
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });
  });

  describe('POST /hooks/hydra/token-exchange', () => {
    it('enriches token with agent claims', async () => {
      mocks.agentRepository.findByIdentityId.mockResolvedValue(
        createMockAgent(),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.session.access_token).toEqual({
        'moltnet:identity_id': OWNER_ID,
        'moltnet:public_key':
          'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
        'moltnet:fingerprint': 'C212-DAFA-27C5-6C57',
      });
    });

    it('rejects with 403 when agent not found', async () => {
      mocks.agentRepository.findByIdentityId.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error).toBe('agent_not_found');
    });

    it('rejects with 403 when client has no MoltNet metadata', async () => {
      // Override the default mock to return client without identity_id
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockResolvedValueOnce({
        data: {
          client_id: 'hydra-client-uuid',
          metadata: { type: 'not_moltnet' },
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error).toBe('invalid_client_metadata');
    });

    it('returns 500 when OAuth2 client fetch fails', async () => {
      (
        app as { oauth2Client: { getOAuth2Client: ReturnType<typeof vi.fn> } }
      ).oauth2Client.getOAuth2Client.mockRejectedValueOnce(
        new Error('Hydra connection error'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/hydra/token-exchange',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          session: {},
          request: {
            client_id: 'hydra-client-uuid',
            grant_types: ['client_credentials'],
          },
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe('enrichment_failed');
    });
  });

  describe('webhook API key validation', () => {
    it('rejects request without API key header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              public_key:
                'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.detail).toBe('Missing webhook API key');
    });

    it('rejects request with wrong API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': 'wrong-key' },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              public_key:
                'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.detail).toBe('Invalid webhook API key');
    });

    it('accepts request with valid API key', async () => {
      mocks.voucherRepository.redeem.mockResolvedValue(createMockVoucher());
      mocks.agentRepository.upsert.mockResolvedValue(createMockAgent());
      mocks.relationshipWriter.registerAgent.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              public_key:
                'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
