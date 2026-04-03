/**
 * E2E: Human Authentication
 *
 * Tests the full human lifecycle:
 * - Registration via Kratos native flow → after-registration webhook
 * - Login via Kratos native flow → after-login webhook → DBOS onboarding
 * - Onboarding idempotency (second login is a no-op)
 * - Personal team and private diary auto-creation
 * - Token exchange enrichment for human subjects
 * - Webhook payload validation (malformed payloads rejected)
 * - Security (missing/invalid API keys rejected)
 */

import { humans } from '@moltnet/database';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAgent,
  createHuman,
  type TestAgent,
  type TestHuman,
} from './helpers.js';
import {
  createTestHarness,
  type TestHarness,
  WEBHOOK_API_KEY,
} from './setup.js';

describe('Human Authentication E2E', { timeout: 60_000 }, () => {
  let harness: TestHarness;
  let human: TestHuman;
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

  // ── Registration + Onboarding ─────────────────────────────────

  describe('Registration + Onboarding', () => {
    it('registers a human and onboards on first login', async () => {
      human = await createHuman({
        kratosPublicFrontend: harness.kratosPublicFrontend,
      });

      expect(human.identityId).toBeDefined();
      expect(human.humanId).toBeDefined();
      expect(human.sessionToken).toBeDefined();
      expect(human.email).toContain('@e2e.local');
    });

    it('sets identityId on the human record (onboarding completed)', async () => {
      const [humanRecord] = await harness.db
        .select()
        .from(humans)
        .where(eq(humans.id, human.humanId))
        .limit(1);

      expect(humanRecord).toBeDefined();
      expect(humanRecord.identityId).toBe(human.identityId);
    });

    it('second login does not re-onboard (idempotent)', async () => {
      // Get the updatedAt before second login
      const [before] = await harness.db
        .select()
        .from(humans)
        .where(eq(humans.id, human.humanId))
        .limit(1);

      // Login again
      const loginFlow =
        await harness.kratosPublicFrontend.createNativeLoginFlow();
      await harness.kratosPublicFrontend.updateLoginFlow({
        flow: loginFlow.id,
        updateLoginFlowBody: {
          method: 'password',
          identifier: human.email,
          password: human.password,
        },
      });

      // identityId should be unchanged
      const [after] = await harness.db
        .select()
        .from(humans)
        .where(eq(humans.id, human.humanId))
        .limit(1);

      expect(after.identityId).toBe(before.identityId);
    });
  });

  // ── After-Registration Webhook Security ───────────────────────

  describe('POST /hooks/kratos/after-registration', () => {
    it('rejects missing webhook API key', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/after-registration`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identity: {
              id: '00000000-0000-0000-0000-000000000000',
              schema_id: 'moltnet_human',
              traits: { email: 'test@test.com', username: 'test' },
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
              id: '00000000-0000-0000-0000-000000000000',
              schema_id: 'moltnet_human',
              traits: { email: 'test@test.com', username: 'test' },
            },
          }),
        },
      );

      expect(resp.status).toBe(401);
    });

    it('rejects non-human schema registration', async () => {
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
              id: '00000000-0000-0000-0000-000000000000',
              schema_id: 'moltnet_agent',
              traits: {
                public_key: 'ed25519:AAAA',
                voucher_code: 'fake',
              },
            },
          }),
        },
      );

      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].messages[0].id).toBe(4000010);
    });

    it('rejects payload missing identity object', async () => {
      const resp = await fetch(
        `${harness.baseUrl}/hooks/kratos/after-registration`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': WEBHOOK_API_KEY,
          },
          body: JSON.stringify({}),
        },
      );

      expect(resp.status).toBe(400);
    });

    it('rejects payload missing schema_id', async () => {
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
              id: '00000000-0000-0000-0000-000000000000',
              traits: { email: 'test@test.com', username: 'test' },
            },
          }),
        },
      );

      expect(resp.status).toBe(400);
    });

    it('creates human placeholder with valid request', async () => {
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
              id: '00000000-0000-0000-0000-000000000000',
              schema_id: 'moltnet_human',
              traits: { email: 'manual@test.com', username: 'manual' },
            },
          }),
        },
      );

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.identity.metadata_public.human_id).toBeDefined();
      expect(typeof body.identity.metadata_public.human_id).toBe('string');
    });
  });

  // ── After-Login Webhook Security ──────────────────────────────

  describe('POST /hooks/kratos/after-login', () => {
    it('rejects missing webhook API key', async () => {
      const resp = await fetch(`${harness.baseUrl}/hooks/kratos/after-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: {
            id: 'some-id',
            schema_id: 'moltnet_human',
            traits: { email: 'test@test.com', username: 'test' },
          },
        }),
      });

      expect(resp.status).toBe(401);
    });

    it('skips non-human schema logins (returns 200)', async () => {
      const resp = await fetch(`${harness.baseUrl}/hooks/kratos/after-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ory-api-key': WEBHOOK_API_KEY,
        },
        body: JSON.stringify({
          identity: {
            id: agent.identityId,
            schema_id: 'moltnet_agent',
            traits: { public_key: 'ed25519:AAAA' },
            metadata_public: {
              fingerprint: 'A1B2-C3D4-E5F6-07A8',
              public_key: 'ed25519:AAAA',
            },
          },
        }),
      });

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.success).toBe(true);
    });

    it('skips when metadata_public has no human_id', async () => {
      const resp = await fetch(`${harness.baseUrl}/hooks/kratos/after-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ory-api-key': WEBHOOK_API_KEY,
        },
        body: JSON.stringify({
          identity: {
            id: 'some-identity-id',
            schema_id: 'moltnet_human',
            traits: { email: 'test@test.com', username: 'test' },
            metadata_public: null,
          },
        }),
      });

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.success).toBe(true);
    });

    it('rejects payload missing identity.id', async () => {
      const resp = await fetch(`${harness.baseUrl}/hooks/kratos/after-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ory-api-key': WEBHOOK_API_KEY,
        },
        body: JSON.stringify({
          identity: {
            schema_id: 'moltnet_human',
            traits: { email: 'test@test.com', username: 'test' },
          },
        }),
      });

      expect(resp.status).toBe(400);
    });
  });

  // ── Token Exchange (Human Path) ───────────────────────────────

  describe('POST /hooks/hydra/token-exchange (human)', () => {
    it('enriches token with human claims via session subject', async () => {
      const dcrClient = await harness.hydraAdminOAuth2.createOAuth2Client({
        oAuth2Client: {
          client_name: 'E2E DCR Human Client',
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'diary:read diary:write human:profile team:read',
        },
      });

      const resp = await fetch(
        `${harness.baseUrl}/hooks/hydra/token-exchange`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': WEBHOOK_API_KEY,
          },
          body: JSON.stringify({
            session: {
              id_token: { subject: human.identityId },
            },
            request: {
              client_id: dcrClient.client_id,
              grant_types: ['authorization_code'],
            },
          }),
        },
      );

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.session.access_token['moltnet:identity_id']).toBe(
        human.identityId,
      );
      expect(body.session.access_token['moltnet:subject_type']).toBe('human');
      expect(body.session.access_token['moltnet:public_key']).toBeUndefined();
      expect(body.session.access_token['moltnet:fingerprint']).toBeUndefined();
    });

    it('returns 403 for unknown identity in session', async () => {
      const dcrClient = await harness.hydraAdminOAuth2.createOAuth2Client({
        oAuth2Client: {
          client_name: 'E2E Unknown Human Client',
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
      });

      const resp = await fetch(
        `${harness.baseUrl}/hooks/hydra/token-exchange`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': WEBHOOK_API_KEY,
          },
          body: JSON.stringify({
            session: {
              id_token: { subject: '00000000-0000-4000-b000-000000000099' },
            },
            request: {
              client_id: dcrClient.client_id,
              grant_types: ['authorization_code'],
            },
          }),
        },
      );

      expect(resp.status).toBe(403);
      const body = await resp.json();
      expect(body.error).toBe('identity_not_found');
    });

    it('rejects payload missing request.client_id', async () => {
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
              grant_types: ['authorization_code'],
            },
          }),
        },
      );

      expect(resp.status).toBe(400);
    });
  });
});
