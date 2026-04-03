/**
 * E2E: Ory webhook handlers (agent paths)
 *
 * Tests the after-settings and token-exchange webhook endpoints
 * for agent subjects. Human-specific webhook tests are in
 * human-auth.e2e.test.ts.
 */

import { cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import {
  createTestHarness,
  type TestHarness,
  WEBHOOK_API_KEY,
} from './setup.js';

describe('Webhook Handlers (Agent)', () => {
  let harness: TestHarness;
  let agent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();

    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
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

  // ── Token Exchange (Agent Path) ────────────────────────────

  describe('POST /hooks/hydra/token-exchange (agent)', () => {
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
      expect(body.session.access_token['moltnet:subject_type']).toBe('agent');
      expect(body.session.access_token['moltnet:fingerprint']).toBeDefined();
      expect(body.session.access_token['moltnet:public_key']).toBeDefined();
    });

    it('returns 500 when client lookup fails', async () => {
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

      expect(resp.status).toBe(500);
      const body = await resp.json();
      expect(body.error).toBe('enrichment_failed');
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
