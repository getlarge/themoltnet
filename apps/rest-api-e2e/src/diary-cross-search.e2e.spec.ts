/**
 * E2E: Cross-diary search (team-based)
 *
 * Verifies that team membership controls cross-diary search access.
 * After Option B, `searchAccessible` uses team IDs from Keto to scope
 * the `diary_search(p_team_ids)` SQL function.
 */

import {
  type Client,
  createClient,
  createDiaryEntry,
  searchDiary,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Cross-diary search (team-based)', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;
  let uniqueContent: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    agentA = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });

    agentB = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });

    // Create a uniquely identifiable entry in agentA's diary
    uniqueContent = `cross-search-sentinel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { error } = await createDiaryEntry({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: agentA.moltnetDiaryId },
      body: { content: uniqueContent, tags: ['cross-search-e2e'] },
    });
    expect(error).toBeUndefined();
  }, 30_000);

  afterAll(async () => {
    await harness?.teardown();
  });

  it('agentA can find the entry via cross-diary search', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agentA.accessToken,
      body: { query: uniqueContent, limit: 5 },
    });
    expect(error).toBeUndefined();
    expect(data!.results.length).toBeGreaterThan(0);
    expect(data!.results[0].content).toBe(uniqueContent);
  });

  it('agentB cannot find agentA entries (separate personal teams)', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agentB.accessToken,
      body: { query: uniqueContent, limit: 5 },
    });
    expect(error).toBeUndefined();
    const found = data!.results.find((r) => r.content === uniqueContent);
    expect(found).toBeUndefined();
  });
});
