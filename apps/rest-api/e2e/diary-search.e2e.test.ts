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
  createDiaryEntry,
  searchDiary,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Diary hybrid search', () => {
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
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Exact term matching (the #214 bug) ──────────────────────

  it('finds entry with exact terms in content', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { query: 'npm audit security vulnerability' },
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
      body: { query: '"npm audit"' },
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

  it('negation with minus excludes matching entries', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { query: 'deploy -staging' },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as {
        results: Array<{ content: string; tags: string[] | null }>;
      }
    ).results;

    // Should find production deploy but not staging deploy via FTS
    for (const result of results) {
      // FTS results should exclude "staging" from content
      if (result.content.includes('Deployed')) {
        expect(result.content).not.toContain('staging');
      }
    }
  });

  // ── Title in semantic search ────────────────────────────────

  it('finds entry by title-only query via semantic search', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { query: 'Security Audit Report' },
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
      body: { query: 'API Design Review' },
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
});
