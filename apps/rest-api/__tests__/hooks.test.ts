import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
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

/** Derive fingerprint the same way the webhook does */
function deriveFingerprint(publicKey: string): string {
  const pubBytes = Buffer.from(publicKey.replace(/^ed25519:/, ''), 'base64');
  const hash = createHash('sha256').update(pubBytes).digest('hex');
  const segments = hash.slice(0, 16).toUpperCase().match(/.{4}/g) ?? [];
  return segments.join('-');
}

describe('Hook routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    // Hooks don't require auth (they're called by Ory services)
    app = await createTestApp(mocks, null);
  });

  describe('POST /hooks/kratos/after-registration', () => {
    const testPublicKey = 'ed25519:AAAA+/bbbb==';
    const expectedFingerprint = deriveFingerprint(testPublicKey);

    const validPayload = {
      identity: {
        id: OWNER_ID,
        traits: {
          moltbook_name: 'Claude',
          public_key: testPublicKey,
          voucher_code: 'a'.repeat(64),
        },
      },
    };

    it('creates agent entry when voucher is valid', async () => {
      mocks.voucherRepository.redeem.mockResolvedValue(createMockVoucher());
      mocks.agentRepository.upsert.mockResolvedValue(createMockAgent());
      mocks.permissionChecker.registerAgent.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(mocks.voucherRepository.redeem).toHaveBeenCalledWith(
        'a'.repeat(64),
        OWNER_ID,
      );
      expect(mocks.agentRepository.upsert).toHaveBeenCalledWith({
        identityId: OWNER_ID,
        moltbookName: 'Claude',
        publicKey: testPublicKey,
        fingerprint: expectedFingerprint,
      });
      expect(mocks.permissionChecker.registerAgent).toHaveBeenCalledWith(
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
      expect(mocks.permissionChecker.registerAgent).not.toHaveBeenCalled();
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
              moltbook_name: 'Claude',
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
      expect(body.messages[0].messages[0].text).toContain('ed25519:<base64>');
      expect(body.messages[0].messages[0].text).toContain('@noble/ed25519');
      expect(mocks.voucherRepository.redeem).not.toHaveBeenCalled();
    });
  });

  describe('POST /hooks/kratos/after-settings', () => {
    it('updates agent entry', async () => {
      mocks.agentRepository.upsert.mockResolvedValue(
        createMockAgent({ publicKey: 'ed25519:NEWKEY==' }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-settings',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              moltbook_name: 'Claude',
              public_key: 'ed25519:NEWKEY==',
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
        'moltnet:moltbook_name': 'Claude',
        'moltnet:public_key': 'ed25519:AAAA+/bbbb==',
        'moltnet:fingerprint': 'A1B2-C3D4-E5F6-07A8',
      });
    });

    it('falls back to minimal claims when agent not found', async () => {
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

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.session.access_token['moltnet:client_id']).toBe(
        'hydra-client-uuid',
      );
      expect(body.session.access_token['moltnet:identity_id']).toBe(OWNER_ID);
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
              moltbook_name: 'Claude',
              public_key: 'ed25519:AAAA+/bbbb==',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Missing webhook API key',
      });
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
              moltbook_name: 'Claude',
              public_key: 'ed25519:AAAA+/bbbb==',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Invalid webhook API key',
      });
    });

    it('accepts request with valid API key', async () => {
      mocks.voucherRepository.redeem.mockResolvedValue(createMockVoucher());
      mocks.agentRepository.upsert.mockResolvedValue(createMockAgent());
      mocks.permissionChecker.registerAgent.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/hooks/kratos/after-registration',
        headers: { 'x-ory-api-key': TEST_WEBHOOK_API_KEY },
        payload: {
          identity: {
            id: OWNER_ID,
            traits: {
              moltbook_name: 'Claude',
              public_key: 'ed25519:AAAA+/bbbb==',
              voucher_code: 'a'.repeat(64),
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
