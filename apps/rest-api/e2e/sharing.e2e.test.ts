/**
 * E2E: Diary sharing between agents
 *
 * Tests entry sharing, shared-with-me listing, and access control.
 * Uses two real agents with real Keto permissions.
 */

import {
  type Client,
  createClient,
  createDiaryEntry,
  getSharedWithMe,
  shareDiaryEntry,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Diary Sharing', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    // Create two agents
    const voucherA = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentA = await createAgent({
      app: harness.app,
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherA,
    });

    const voucherB = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentB = await createAgent({
      app: harness.app,
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherB,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Share Entry ─────────────────────────────────────────────

  describe('POST /diary/entries/:id/share', () => {
    it('shares an entry with another agent by fingerprint', async () => {
      // Agent A creates an entry
      const { data: entry } = await createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        body: { content: 'Shared knowledge from Agent A', title: 'Shared' },
      });

      // Agent A shares it with Agent B
      const { data, error } = await shareDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { id: entry!.id },
        body: { sharedWith: agentB.keyPair.fingerprint },
      });

      expect(error).toBeUndefined();
      expect(data!.success).toBe(true);
      expect(data!.sharedWith).toBe(agentB.keyPair.fingerprint);
    });

    it('returns 404 for non-existent target fingerprint', async () => {
      const { data: entry } = await createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        body: { content: 'Share target missing' },
      });

      const { data, error, response } = await shareDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { id: entry!.id },
        body: { sharedWith: 'AAAA-BBBB-CCCC-DDDD' },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('returns 403 when sharing entry you do not own', async () => {
      // Agent A creates an entry
      const { data: entry } = await createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        body: { content: 'Only A owns this' },
      });

      // Agent B tries to share A's entry
      const { data, error, response } = await shareDiaryEntry({
        client,
        auth: () => agentB.accessToken,
        path: { id: entry!.id },
        body: { sharedWith: agentA.keyPair.fingerprint },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(403);
    });

    it('rejects unauthenticated request', async () => {
      const { data, error, response } = await shareDiaryEntry({
        client,
        path: { id: '00000000-0000-0000-0000-000000000000' },
        body: { sharedWith: agentB.keyPair.fingerprint },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(401);
    });
  });

  // ── Shared With Me ──────────────────────────────────────────

  describe('GET /diary/shared-with-me', () => {
    it('lists entries shared with the authenticated agent', async () => {
      // Agent A creates and shares an entry with Agent B
      const { data: entry } = await createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        body: {
          content: 'Shared for listing test',
          title: 'SharedWithMeTest',
        },
      });

      await shareDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { id: entry!.id },
        body: { sharedWith: agentB.keyPair.fingerprint },
      });

      // Agent B checks shared-with-me
      const { data, error } = await getSharedWithMe({
        client,
        auth: () => agentB.accessToken,
      });

      expect(error).toBeUndefined();
      expect(data!.entries).toBeDefined();
      expect(data!.entries.length).toBeGreaterThanOrEqual(1);

      const shared = data!.entries.find(
        (e: { content: string }) => e.content === 'Shared for listing test',
      );
      expect(shared).toBeDefined();
    });

    it('returns empty list when nothing is shared', async () => {
      // Create a fresh agent with nothing shared
      const voucherC = await createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      });
      const agentC = await createAgent({
        app: harness.app,
        baseUrl: harness.baseUrl,
        identityApi: harness.identityApi,
        hydraAdminOAuth2: harness.hydraAdminOAuth2,
        webhookApiKey: harness.webhookApiKey,
        voucherCode: voucherC,
      });

      const { data, error } = await getSharedWithMe({
        client,
        auth: () => agentC.accessToken,
      });

      expect(error).toBeUndefined();
      expect(data!.entries).toEqual([]);
    });

    it('rejects unauthenticated request', async () => {
      const { data, error, response } = await getSharedWithMe({ client });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(401);
    });
  });
});
