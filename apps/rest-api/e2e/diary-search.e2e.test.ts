/**
 * E2E: Diary hybrid search (semantic + full-text)
 *
 * Tests that:
 * 1. Exact terms in content are found via FTS (websearch_to_tsquery OR semantics)
 * 2. Phrase search with quotes works
 * 3. Negation with `-` works
 * 4. Title-only terms are found via semantic search (title in embedding)
 */

import {
  type Client,
  createClient,
  createDiaryEntry as apiCreateDiaryEntry,
  reflectDiary,
  searchDiary,
  updateDiaryEntry,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Diary hybrid search', () => {
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

    // Seed entries for search tests
    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content:
          'Ran npm audit and found a security vulnerability in dependencies',
        title: 'Security Audit Report',
        tags: ['security', 'deps'],
      },
    });

    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Deployed the staging environment with new auth module',
        title: 'Staging Deploy',
        tags: ['deploy', 'staging'],
      },
    });

    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Deployed production release v3.2.1 with hotfix',
        title: 'Production Deploy',
        tags: ['deploy', 'production'],
      },
    });

    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Reviewed the new API design document for v4',
        title: 'API Design Review',
        tags: ['design'],
      },
    });

    // Seed: episodic entry for entryType filter test
    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'This is an episodic memory about a meeting',
        entryType: 'episodic',
        tags: ['meeting'],
      },
    });

    // Seed: superseded entry for excludeSuperseded test
    const { data: supersededEntry } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'Old approach (superseded)',
        tags: ['architecture'],
      },
    });
    const { data: newEntry } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content: 'New approach (replaces old)',
        tags: ['architecture'],
      },
    });
    // Mark the first as superseded
    if (supersededEntry && newEntry) {
      await updateDiaryEntry({
        client,
        auth: () => agent.accessToken,
        path: {
          diaryId: agent.privateDiaryId,
          entryId: supersededEntry.id,
        },
        body: { supersededBy: newEntry.id },
      });
    }
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Exact term matching (the #214 bug) ──────────────────────

  it('finds entry with exact terms in content', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: {
        query: 'npm audit security vulnerability',
        diaryId: agent.privateDiaryId,
      },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as {
        results: Array<{ content: string; title: string | null }>;
      }
    ).results;
    expect(results.length).toBeGreaterThanOrEqual(1);

    const match = results.find((r) => r.content.includes('npm audit'));
    expect(match).toBeDefined();
  });

  // ── Phrase search ───────────────────────────────────────────

  it('phrase search with quotes matches exact sequence', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { query: '"npm audit"', diaryId: agent.privateDiaryId },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as {
        results: Array<{ content: string }>;
      }
    ).results;
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('npm audit');
  });

  // ── Negation ────────────────────────────────────────────────

  // TODO(#295): vector RRF has no negation semantics — entries excluded by FTS
  // can still surface via embedding similarity. Fix requires a SQL post-filter
  // in diary_search() to hard-enforce websearch_to_tsquery predicates.
  it.skip('negation with minus excludes matching entries', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { query: 'deploy -staging', diaryId: agent.privateDiaryId },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as {
        results: Array<{ content: string; tags: string[] | null }>;
      }
    ).results;

    expect(results.length).toBeGreaterThanOrEqual(1);

    // Should find a deploy entry, but staging-tagged entries should not be ranked in the top results
    const topResults = results.slice(0, 5);

    const deployHit = topResults.find((r) => r.content.includes('Deployed'));
    expect(deployHit).toBeDefined();

    const stagingInTop = topResults.find(
      (r) => Array.isArray(r.tags) && r.tags.includes('staging'),
    );
    expect(stagingInTop).toBeUndefined();
  });

  // ── Title in semantic search ────────────────────────────────

  it('finds entry by title-only query via semantic search', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { query: 'Security Audit Report', diaryId: agent.privateDiaryId },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as {
        results: Array<{ content: string; title: string | null }>;
      }
    ).results;
    expect(results.length).toBeGreaterThanOrEqual(1);

    const match = results.find((r) => r.title === 'Security Audit Report');
    expect(match).toBeDefined();
  });

  it('finds entry by API design query matching title', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { query: 'API Design Review', diaryId: agent.privateDiaryId },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as {
        results: Array<{ content: string; title: string | null }>;
      }
    ).results;
    expect(results.length).toBeGreaterThanOrEqual(1);

    const match = results.find((r) => r.title === 'API Design Review');
    expect(match).toBeDefined();
  });

  // ── Cross-agent isolation ───────────────────────────────────

  describe('Cross-agent isolation', () => {
    let agentB: TestAgent;

    beforeAll(async () => {
      const voucherB = await createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      });

      agentB = await createAgent({
        baseUrl: harness.baseUrl,
        identityApi: harness.identityApi,
        hydraAdminOAuth2: harness.hydraAdminOAuth2,
        webhookApiKey: harness.webhookApiKey,
        voucherCode: voucherB,
      });
    });

    it('agentB cannot search agentA diary', async () => {
      const { error, response } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { query: 'npm audit', diaryId: agent.privateDiaryId },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('agentB cannot reflect on agentA diary', async () => {
      const { error, response } = await reflectDiary({
        client,
        auth: () => agentB.accessToken,
        query: { diaryId: agent.privateDiaryId },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });
  });

  // ── P1 regression: filter-only fallback preserves entryTypes ──

  describe('Filter-only search (no query)', () => {
    it('entryTypes filter returns only matching types', async () => {
      const { data, error } = await searchDiary({
        client,
        auth: () => agent.accessToken,
        body: {
          entryTypes: ['episodic'],
          diaryId: agent.privateDiaryId,
        },
      });

      expect(error).toBeUndefined();
      const results = (
        data as unknown as { results: Array<{ entryType: string }> }
      ).results;
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every((r) => r.entryType === 'episodic')).toBe(true);
    });

    it('excludeSuperseded hides superseded entries', async () => {
      const { data: allData } = await searchDiary({
        client,
        auth: () => agent.accessToken,
        body: {
          tags: ['architecture'],
          diaryId: agent.privateDiaryId,
        },
      });

      const { data: filteredData, error } = await searchDiary({
        client,
        auth: () => agent.accessToken,
        body: {
          tags: ['architecture'],
          excludeSuperseded: true,
          diaryId: agent.privateDiaryId,
        },
      });

      expect(error).toBeUndefined();
      const allResults = (
        allData as unknown as {
          results: Array<{ supersededBy: string | null }>;
        }
      ).results;
      const filteredResults = (
        filteredData as unknown as {
          results: Array<{ supersededBy: string | null }>;
        }
      ).results;

      // Without filter: includes superseded entry
      const hasSuperseded = allResults.some((r) => r.supersededBy !== null);
      expect(hasSuperseded).toBe(true);

      // With filter: no superseded entries
      expect(filteredResults.every((r) => r.supersededBy === null)).toBe(true);
    });
  });
});
