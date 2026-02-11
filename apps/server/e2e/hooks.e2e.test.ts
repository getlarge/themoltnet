/**
 * E2E: Ory webhook handlers
 *
 * Tests the after-registration, after-settings, and token-exchange
 * webhook endpoints directly. Validates auth, input validation,
 * and correct behavior.
 */

import { cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import {
  createTestHarness,
  type TestHarness,
  WEBHOOK_API_KEY,
} from './setup.js';

describe('Webhook Handlers', () => {
  let harness: TestHarness;
  let agent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();

    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agent = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── After Registration ──────────────────────────────────────

  describe('POST /hooks/kratos/after-registration', () => {
    it('rejects missing webhook API key', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/after-registration`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identity: {
              id: 'fake-id',
              traits: { public_key: 'ed25519:AAAA', voucher_code: 'fake' },
            },
          }),
        },
      );

      expect(resp.status).toBe(401);
    });

    it('rejects invalid webhook API key', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/after-registration`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': 'wrong-key',
          },
          body: JSON.stringify({
            identity: {
              id: 'fake-id',
              traits: { public_key: 'ed25519:AAAA', voucher_code: 'fake' },
            },
          }),
        },
      );

      expect(resp.status).toBe(401);
    });

    it('rejects invalid public key format', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/after-registration`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': WEBHOOK_API_KEY,
          },
          body: JSON.stringify({
            identity: {
              id: 'test-invalid-key-id',
              traits: {
                public_key: 'not-ed25519-format',
                voucher_code: 'doesnt-matter',
              },
            },
          }),
        },
      );

      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.messages).toBeDefined();
      expect(body.messages[0].instance_ptr).toBe('#/traits/public_key');
    });

    it('rejects invalid voucher code', async () => {
      const keyPair = await cryptoService.generateKeyPair();

      // Create a Kratos identity first so the webhook can process it
      const { data: identity } = await harness.identityApi.createIdentity({
        createIdentityBody: {
          schema_id: 'moltnet_agent',
          traits: {
            public_key: keyPair.publicKey,
            voucher_code: 'nonexistent-voucher',
          },
          credentials: {
            password: {
              config: { password: 'e2e-test-password-invalid-voucher' },
            },
          },
        },
      });

      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/after-registration`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': WEBHOOK_API_KEY,
          },
          body: JSON.stringify({
            identity: {
              id: identity.id,
              traits: {
                public_key: keyPair.publicKey,
                voucher_code: 'nonexistent-voucher',
              },
            },
          }),
        },
      );

      expect(resp.status).toBe(403);
      const body = await resp.json();
      expect(body.messages).toBeDefined();
      expect(body.messages[0].instance_ptr).toBe('#/traits/voucher_code');
    });

    it('succeeds with valid key and voucher', async () => {
      const keyPair = await cryptoService.generateKeyPair();
      const voucher = await createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      });

      const { data: identity } = await harness.identityApi.createIdentity({
        createIdentityBody: {
          schema_id: 'moltnet_agent',
          traits: {
            public_key: keyPair.publicKey,
            voucher_code: voucher,
          },
          credentials: {
            password: {
              config: { password: 'e2e-test-password-webhook-success' },
            },
          },
        },
      });

      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/after-registration`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': WEBHOOK_API_KEY,
          },
          body: JSON.stringify({
            identity: {
              id: identity.id,
              traits: {
                public_key: keyPair.publicKey,
                voucher_code: voucher,
              },
            },
          }),
        },
      );

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.identity.metadata_public.fingerprint).toBeDefined();
      expect(body.identity.metadata_public.public_key).toBe(keyPair.publicKey);
    });
  });

  // ── After Settings (Key Rotation) ───────────────────────────

  describe('POST /hooks/kratos/after-settings', () => {
    it('updates agent key on settings change', async () => {
      const newKeyPair = await cryptoService.generateKeyPair();

      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/after-settings`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': WEBHOOK_API_KEY,
          },
          body: JSON.stringify({
            identity: {
              id: agent.identityId,
              traits: {
                public_key: newKeyPair.publicKey,
              },
            },
          }),
        },
      );

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.success).toBe(true);
    });

    it('rejects invalid public key format', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/after-settings`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': WEBHOOK_API_KEY,
          },
          body: JSON.stringify({
            identity: {
              id: agent.identityId,
              traits: { public_key: 'invalid-format' },
            },
          }),
        },
      );

      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.messages[0].instance_ptr).toBe('#/traits/public_key');
    });

    it('rejects missing webhook API key', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/after-settings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identity: {
              id: agent.identityId,
              traits: { public_key: agent.keyPair.publicKey },
            },
          }),
        },
      );

      expect(resp.status).toBe(401);
    });
  });

  // ── Token Exchange ──────────────────────────────────────────

  describe('POST /hooks/hydra/token-exchange', () => {
    it('enriches token with agent claims', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/hydra/token-exchange`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': WEBHOOK_API_KEY,
          },
          body: JSON.stringify({
            session: {},
            request: {
              client_id: agent.clientId,
              grant_types: ['client_credentials'],
            },
          }),
        },
      );

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.session.access_token).toBeDefined();
      expect(body.session.access_token['moltnet:identity_id']).toBe(
        agent.identityId,
      );
      expect(body.session.access_token['moltnet:fingerprint']).toBeDefined();
    });

    it('returns minimal claims for unknown client', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/hydra/token-exchange`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': WEBHOOK_API_KEY,
          },
          body: JSON.stringify({
            session: {},
            request: {
              client_id: 'nonexistent-client-id',
              grant_types: ['client_credentials'],
            },
          }),
        },
      );

      // Should return 200 with fallback claims (graceful degradation)
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.session.access_token['moltnet:client_id']).toBe(
        'nonexistent-client-id',
      );
    });

    it('rejects missing webhook API key', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/hydra/token-exchange`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session: {},
            request: {
              client_id: 'test',
              grant_types: ['client_credentials'],
            },
          }),
        },
      );

      expect(resp.status).toBe(401);
    });
  });
});
