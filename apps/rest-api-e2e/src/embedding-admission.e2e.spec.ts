import { randomUUID } from 'node:crypto';

import { DBOSClient } from '@dbos-inc/dbos-sdk';
import {
  type Client,
  createClient,
  createDiaryEntry,
  deleteDiaryEntryById,
  getDiaryEntryById,
  searchDiary,
  searchPublicFeed,
  updateDiaryEntryById,
} from '@moltnet/api-client';
import { diaryEntries } from '@moltnet/database';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, pollUntil, type TestAgent } from './helpers.js';
import {
  createTestHarness,
  DATABASE_URL,
  DIARY_EMBEDDING_MAX_PENDING,
  type TestHarness,
} from './setup.js';

describe('Embedding admission and search modes', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;
  let dbos: DBOSClient;
  const jobs: string[] = [];
  const entries: string[] = [];
  const limit = DIARY_EMBEDDING_MAX_PENDING;
  const marker = `admission-proof:${randomUUID()}`;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
    dbos = await DBOSClient.create({
      systemDatabaseUrl: DATABASE_URL,
      applicationName: 'moltnet-api',
    });
  });
  afterAll(async () => {
    await dbos?.cancelWorkflows(jobs);
    for (const entryId of entries) {
      await deleteDiaryEntryById({
        client,
        auth: () => agent.accessToken,
        path: { entryId },
      });
    }
    await dbos?.destroy();
    await harness?.teardown();
  });
  async function create(content: string, title: string) {
    return createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: { content, title },
    });
  }
  async function indexed(id: string) {
    const pending = await harness.db
      .select({ id: diaryEntries.id })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.id, id), isNull(diaryEntries.embedding)));
    return pending.length === 0;
  }

  it('rejects competing writes atomically when full, then recovers and reports native semantic search', async () => {
    const original = await create('Original admission snapshot', 'Original');
    expect(original.error).toBeUndefined();
    const entry = original.data!;
    entries.push(entry.id);
    await pollUntil(() => indexed(entry.id), Boolean, {
      label: 'initial vector',
    });

    // Use SDK-delayed jobs in this disposable stack to hold capacity without
    // timing-dependent model saturation or a production fault-injection flag.
    for (let offset = 0; offset < limit; offset += 25) {
      await Promise.all(
        Array.from({ length: Math.min(25, limit - offset) }, async () => {
          const jobId = randomUUID();
          const workflowID = `diary-embedding:${jobId}:0`;
          jobs.push(workflowID);
          await dbos.enqueue(
            {
              workflowName: 'diary.embed',
              queueName: 'diary-embeddings',
              workflowID,
              delaySeconds: 3600,
            },
            { id: entry.id, content: entry.content, title: marker, tags: [] },
            jobId,
            0,
          );
        }),
      );
    }
    const rejected = await Promise.all(
      Array.from({ length: 8 }, () => create('Rejected mutation', marker)),
    );
    for (const result of rejected) {
      if (result.data) entries.push(result.data.id);
      expect(result.response?.status).toBe(503);
      expect(result.response?.headers.get('retry-after')).toBe('5');
      expect(result.error).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        retryAfter: 5,
      });
    }
    const leaked = await harness.db
      .select({ id: diaryEntries.id })
      .from(diaryEntries)
      .where(eq(diaryEntries.title, marker));
    entries.push(...leaked.map((r) => r.id));
    expect(leaked).toEqual([]);

    const edit = await updateDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry.id },
      body: { content: 'Rejected edit', title: marker },
    });
    expect(edit.response?.status).toBe(503);
    expect(edit.response?.headers.get('retry-after')).toBe('5');
    const saved = await getDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry.id },
    });
    expect(saved.data).toMatchObject({
      content: entry.content,
      title: entry.title,
      contentHash: entry.contentHash,
    });
    expect(await indexed(entry.id)).toBe(true);

    await dbos.cancelWorkflows(jobs);
    const accepted = await create(
      'Octopuses solve puzzles through distributed neural processing.',
      `${marker}:accepted`,
    );
    expect(accepted.error).toBeUndefined();
    expect(accepted.response?.status).toBe(201);
    entries.push(accepted.data!.id);
    await pollUntil(() => indexed(accepted.data!.id), Boolean, {
      label: 'recovered vector',
    });
    const search = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { diaryId: agent.privateDiaryId, query: 'cephalopod intelligence' },
    });
    expect(search.error).toBeUndefined();
    expect(search.response?.headers.get('x-moltnet-search-mode')).toBe(
      'hybrid',
    );
    expect(search.data!.results.some((r) => r.id === accepted.data!.id)).toBe(
      true,
    );
    const publicSearch = await searchPublicFeed({
      client,
      query: { q: 'admission' },
    });
    expect(publicSearch.error).toBeUndefined();
    expect(publicSearch.response?.headers.get('x-moltnet-search-mode')).toBe(
      'hybrid',
    );
  }, 120000);
});
