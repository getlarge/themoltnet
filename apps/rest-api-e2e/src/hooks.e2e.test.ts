/**
 * E2E: Ory webhook handlers (agent paths)
 *
 * Tests the settings validation, after-settings, and token-exchange endpoints
 * for agent subjects. Human-specific webhook tests are in
 * human-auth.e2e.test.ts.
 */

import { cryptoService } from '@moltnet/crypto-service';
import { createAgentRepository } from '@moltnet/database';
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
  let agentRepository: ReturnType<typeof createAgentRepository>;

  beforeAll(async () => {
    harness = await createTestHarness();

    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
    agentRepository = createAgentRepository(harness.db);
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Settings Validation (Pre-Persist) ───────────────────────

  describe('POST /hooks/kratos/validate-settings', () => {
    const validateSettings = (publicKey: string) =>
      fetch(`${harness.baseUrl}/hooks/kratos/validate-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ory-api-key': WEBHOOK_API_KEY,
        },
        body: JSON.stringify({
          identity: { id: agent.identityId, traits: { public_key: publicKey } },
        }),
      });

    it('accepts the unchanged key a password change resubmits', async () => {
      const before = await agentRepository.findByIdentityId(agent.identityId);

      const resp = await validateSettings(agent.keyPair.publicKey);

      expect(resp.status).toBe(200);
      const body = (await resp.json()) as { success: boolean };
      expect(body.success).toBe(true);
      const after = await agentRepository.findByIdentityId(agent.identityId);
      expect(after).toEqual(before);
    });

    it('rejects a different key without updating the agent projection', async () => {
      const before = await agentRepository.findByIdentityId(agent.identityId);
      const newKeyPair = await cryptoService.generateKeyPair();

      const resp = await validateSettings(newKeyPair.publicKey);

      expect(resp.status).toBe(400);
      const body = (await resp.json()) as {
        messages: Array<{ instance_ptr: string }>;
      };
      expect(body.messages[0].instance_ptr).toBe('#/traits/public_key');
      const after = await agentRepository.findByIdentityId(agent.identityId);
      expect(after).toEqual(before);
    });

    it('rejects invalid public key format', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/validate-settings`,
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
      const body = (await resp.json()) as {
        messages: Array<{ instance_ptr: string }>;
      };
      expect(body.messages[0].instance_ptr).toBe('#/traits/public_key');
    });

    it('rejects a public key with the wrong decoded length', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/validate-settings`,
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
                public_key: `ed25519:${Buffer.alloc(31).toString('base64')}`,
              },
            },
          }),
        },
      );

      expect(resp.status).toBe(400);
      const body = (await resp.json()) as {
        messages: Array<{
          instance_ptr: string;
          messages: Array<{ text: string }>;
        }>;
      };
      expect(body.messages[0].instance_ptr).toBe('#/traits/public_key');
      expect(body.messages[0].messages[0].text).toContain('exactly 32 bytes');
    });

    it('rejects missing webhook API key', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/validate-settings`,
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

      expect(resp.status).toBe(403);
    });
  });

  // ── After Settings (Post-Persist Key Projection) ────────────

  describe('POST /hooks/kratos/after-settings', () => {
    it.each([
      [
        'a different key',
        async () => (await cryptoService.generateKeyPair()).publicKey,
      ],
      ['a malformed key', async () => 'invalid-format'],
    ])('never changes the persisted agent key for %s', async (_case, key) => {
      const before = await agentRepository.findByIdentityId(agent.identityId);

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
              traits: { public_key: await key() },
            },
          }),
        },
      );

      expect(resp.status).toBe(200);
      const after = await agentRepository.findByIdentityId(agent.identityId);
      expect(after?.publicKey).toBe(before?.publicKey);
      expect(after?.fingerprint).toBe(before?.fingerprint);
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

      expect(resp.status).toBe(403);
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
      const body = (await resp.json()) as {
        session: { access_token: Record<string, unknown> };
      };
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
      const body = (await resp.json()) as { error: string };
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

      expect(resp.status).toBe(403);
    });
  });
});
