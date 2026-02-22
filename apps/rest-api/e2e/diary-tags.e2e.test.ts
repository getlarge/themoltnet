/**
 * E2E: Diary tags filter and embedding quality
 *
 * Tests that:
 * 1. Tags filter works in list (GET /diary/entries?tags=...)
 * 2. Tags filter works in search (POST /diary/search with tags)
 * 3. Tags included in embeddings improve semantic search relevance
 * 4. Tags filter is AND (contains-all) — entry must have ALL specified tags
 */

import {
  type Client,
  createClient,
  createDiaryEntry as apiCreateDiaryEntry,
  listDiaryEntries as apiListDiaryEntries,
  searchDiary,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Diary tags filter', () => {
  function createDiaryEntry(
    args: Parameters<typeof apiCreateDiaryEntry>[0] & {
      path?: { diaryId?: string };
    },
  ) {
    return apiCreateDiaryEntry({
      ...args,
      path: { diaryId: args.path?.diaryId ?? agent.privateDiaryId },
    });
  }

  function listDiaryEntries(
    args: Parameters<typeof apiListDiaryEntries>[0] & {
      path?: { diaryId?: string };
    },
  ) {
    return apiListDiaryEntries({
      ...args,
      path: { diaryId: args.path?.diaryId ?? agent.privateDiaryId },
    });
  }

  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;

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

    // Seed entries with distinct tag combinations
    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Deployed API v2.1 to production',
        tags: ['deploy', 'production'],
      },
    });

    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Deployed staging hotfix for auth module',
        tags: ['deploy', 'staging'],
      },
    });

    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Reviewed PR #42 for security audit',
        tags: ['code-review', 'security'],
      },
    });

    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Committed accountable changes to auth module',
        tags: ['accountable-commit', 'medium-risk'],
      },
    });

    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Entry with no tags at all',
      },
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── List with tags filter ──────────────────────────────────

  it('filters list by single tag', async () => {
    const { data, error } = await listDiaryEntries({
      client,
      auth: () => agent.accessToken,
      query: { tags: 'deploy' },
    });

    expect(error).toBeUndefined();
    const items = (data as unknown as { items: Array<{ tags: string[] }> })
      .items;
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.tags).toContain('deploy');
    }
  });

  it('filters list by multiple tags (AND semantics)', async () => {
    const { data, error } = await listDiaryEntries({
      client,
      auth: () => agent.accessToken,
      query: { tags: 'deploy,production' },
    });

    expect(error).toBeUndefined();
    const items = (data as unknown as { items: Array<{ tags: string[] }> })
      .items;
    expect(items.length).toBe(1);
    expect(items[0].tags).toContain('deploy');
    expect(items[0].tags).toContain('production');
  });

  it('returns empty when no entries match tag', async () => {
    const { data, error } = await listDiaryEntries({
      client,
      auth: () => agent.accessToken,
      query: { tags: 'nonexistent-tag' },
    });

    expect(error).toBeUndefined();
    const items = (data as unknown as { items: unknown[] }).items;
    expect(items.length).toBe(0);
  });

  it('returns all entries when tags param is omitted', async () => {
    const { data, error } = await listDiaryEntries({
      client,
      auth: () => agent.accessToken,
    });

    expect(error).toBeUndefined();
    const items = (data as unknown as { items: unknown[] }).items;
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  // ── Search with tags filter ────────────────────────────────

  it('filters search results by tag', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: {
        query: 'deploy',
        tags: ['production'],
        diaryId: agent.privateDiaryId,
      },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as {
        results: Array<{ content: string; tags: string[] }>;
      }
    ).results;
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      expect(result.tags).toContain('production');
    }
  });

  it('search with tags filters out non-matching entries', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: {
        query: 'deploy',
        tags: ['code-review'],
        diaryId: agent.privateDiaryId,
      },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as {
        results: Array<{ content: string; tags: string[] }>;
      }
    ).results;
    // "deploy" in query but filtered to code-review tag — shouldn't match deploy entries
    for (const result of results) {
      expect(result.tags).toContain('code-review');
    }
  });

  it('search with nonexistent tag returns empty', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: {
        query: 'deploy',
        tags: ['does-not-exist'],
        diaryId: agent.privateDiaryId,
      },
    });

    expect(error).toBeUndefined();
    const results = (data as unknown as { results: unknown[] }).results;
    expect(results.length).toBe(0);
  });

  // ── Embedding quality: tags improve semantic relevance ─────

  it('semantic search for tag name finds tagged entries even without tag in content', async () => {
    // Create an entry where the tag name does NOT appear in the content
    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Fixed a bug in the login flow',
        tags: ['hotfix'],
      },
    });

    // Search for "hotfix" — should surface the entry because
    // "tag:hotfix" is included in the embedding text
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { query: 'hotfix', diaryId: agent.privateDiaryId },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as {
        results: Array<{ content: string; tags: string[] | null }>;
      }
    ).results;

    const hotfixEntry = results.find(
      (r) => r.content === 'Fixed a bug in the login flow',
    );
    expect(hotfixEntry).toBeDefined();
    expect(hotfixEntry!.tags).toContain('hotfix');
  });

  it('accountable-commit tag is reliably found via search', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { tags: ['accountable-commit'], diaryId: agent.privateDiaryId },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as {
        results: Array<{ content: string; tags: string[] }>;
      }
    ).results;
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      expect(result.tags).toContain('accountable-commit');
    }
  });
});
