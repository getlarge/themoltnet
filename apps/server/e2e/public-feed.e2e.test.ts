/**
 * E2E: Public Feed (no auth required)
 *
 * Tests the unauthenticated public feed endpoints.
 * Creates agents, makes some entries public, then verifies
 * the public feed returns them without authentication.
 */

import {
  type Client,
  createClient,
  createDiaryEntry,
  getPublicEntry,
  getPublicFeed,
  setDiaryEntryVisibility,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Public Feed', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;
  let publicEntryId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

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

    // Create a public entry for testing
    const { data: entry } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Public e2e test entry',
        tags: ['e2e', 'public-feed'],
      },
    });

    await setDiaryEntryVisibility({
      client,
      auth: () => agent.accessToken,
      path: { id: entry!.id },
      body: { visibility: 'public' },
    });

    publicEntryId = entry!.id;
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── GET /public/feed ──────────────────────────────────────

  describe('GET /public/feed', () => {
    it('returns public entries without authentication', async () => {
      const { data, error } = await getPublicFeed({ client });

      expect(error).toBeUndefined();
      expect(data!.items).toBeDefined();
      expect(data!.items.length).toBeGreaterThanOrEqual(1);
    });

    it('includes author fingerprint and publicKey', async () => {
      const { data } = await getPublicFeed({ client });

      const entry = data!.items.find(
        (e: { id: string }) => e.id === publicEntryId,
      );
      expect(entry).toBeDefined();
      expect(entry!.author).toBeDefined();
      expect(entry!.author.fingerprint).toBe(agent.keyPair.fingerprint);
      expect(entry!.author.publicKey).toBeDefined();
    });

    it('does not include private entries', async () => {
      const { data: privateEntry } = await createDiaryEntry({
        client,
        auth: () => agent.accessToken,
        body: { content: 'This is private and should not appear in feed' },
      });

      const { data } = await getPublicFeed({ client });

      const found = data!.items.find(
        (e: { id: string }) => e.id === privateEntry!.id,
      );
      expect(found).toBeUndefined();
    });

    it('respects limit parameter', async () => {
      const { data } = await getPublicFeed({
        client,
        query: { limit: 1 },
      });

      expect(data!.items.length).toBeLessThanOrEqual(1);
    });

    it('supports cursor-based pagination', async () => {
      // Create a second public entry
      const { data: entry2 } = await createDiaryEntry({
        client,
        auth: () => agent.accessToken,
        body: { content: 'Second public entry for pagination' },
      });
      await setDiaryEntryVisibility({
        client,
        auth: () => agent.accessToken,
        path: { id: entry2!.id },
        body: { visibility: 'public' },
      });

      // Fetch page 1 with limit=1
      const { data: page1 } = await getPublicFeed({
        client,
        query: { limit: 1 },
      });

      expect(page1!.items).toHaveLength(1);
      expect(page1!.nextCursor).toBeDefined();
      expect(page1!.nextCursor).not.toBeNull();

      // Fetch page 2 using cursor
      const { data: page2 } = await getPublicFeed({
        client,
        query: { limit: 1, cursor: page1!.nextCursor! },
      });

      expect(page2!.items).toHaveLength(1);
      // Pages should have different entries
      expect(page2!.items[0].id).not.toBe(page1!.items[0].id);
    });

    it('filters by tag', async () => {
      const { data } = await getPublicFeed({
        client,
        query: { tag: 'e2e' },
      });

      expect(data!.items.length).toBeGreaterThanOrEqual(1);
      for (const item of data!.items) {
        expect(item.tags).toContain('e2e');
      }
    });

    it('returns 400 for invalid cursor', async () => {
      const { error, response } = await getPublicFeed({
        client,
        query: { cursor: 'not-a-valid-cursor' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });
  });

  // ── GET /public/entry/:id ─────────────────────────────────

  describe('GET /public/entry/:id', () => {
    it('returns a single public entry without authentication', async () => {
      const { data, error } = await getPublicEntry({
        client,
        path: { id: publicEntryId },
      });

      expect(error).toBeUndefined();
      expect(data!.id).toBe(publicEntryId);
      expect(data!.content).toBe('Public e2e test entry');
      expect(data!.author.fingerprint).toBe(agent.keyPair.fingerprint);
      expect(typeof data!.injectionRisk).toBe('boolean');
    });

    it('returns 404 for non-existent entry', async () => {
      const { error, response } = await getPublicEntry({
        client,
        path: { id: '00000000-0000-0000-0000-000000000000' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('returns 404 for private entry accessed via public endpoint', async () => {
      const { data: privateEntry } = await createDiaryEntry({
        client,
        auth: () => agent.accessToken,
        body: { content: 'Cannot be read via public endpoint' },
      });

      const { error, response } = await getPublicEntry({
        client,
        path: { id: privateEntry!.id },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });
  });
});
