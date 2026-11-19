/** Real API/model/DBOS coverage for the background-enrichment review findings. */
import { randomUUID } from 'node:crypto';

import { DBOSClient } from '@dbos-inc/dbos-sdk';
import {
  type Client,
  createClient,
  createDiaryEntry,
  deleteDiaryEntryById,
  getDiaryEntryById,
  searchDiary,
  updateDiaryEntryById,
} from '@moltnet/api-client';
import { diaryEntries } from '@moltnet/database';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, pollUntil, type TestAgent } from './helpers.js';
import { createTestHarness, DATABASE_URL, type TestHarness } from './setup.js';

const ENQUEUE_MARKER = 'review-proof:enqueue-failure';
const PERMANENT_MARKER = 'review-proof:permanent-failure';
const MAX_ATTEMPTS = 10;
interface Job {
  workflow_uuid: string;
  status: string;
}

function p95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

describe('Background diary embeddings', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;
  let dbos: DBOSClient;
  const entries: string[] = [];

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

  async function jobs(entryId: string): Promise<Job[]> {
    const result = await harness.db.execute(sql`
      SELECT workflow_uuid, status FROM dbos.workflow_status
      WHERE name = 'diary.embed' AND inputs LIKE ${`%${entryId}%`}
      ORDER BY created_at, workflow_uuid
    `);
    return result.rows as unknown as Job[];
  }
  async function indexed(ids: string[]) {
    const rows = await harness.db
      .select({ id: diaryEntries.id })
      .from(diaryEntries)
      .where(
        and(inArray(diaryEntries.id, ids), isNull(diaryEntries.embedding)),
      );
    return rows.length === 0;
  }
  async function create(content: string, title = 'review-proof:entry') {
    const { data, error } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: { content, title },
    });
    expect(error).toBeUndefined();
    expect(data).toBeDefined();
    entries.push(data!.id);
    return data!;
  }
  async function rejectEnqueue() {
    // The marker restricts fault injection to this test's synthetic entry.
    await harness.db.execute(sql`
      CREATE OR REPLACE FUNCTION public.e2e_reject_diary_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic diary enqueue failure'; END $$
    `);
    await harness.db.execute(sql`
      CREATE TRIGGER e2e_reject_diary_enqueue BEFORE INSERT ON dbos.workflow_status
      FOR EACH ROW WHEN (NEW.name = 'diary.embed' AND NEW.inputs LIKE '%review-proof:enqueue-failure%')
      EXECUTE FUNCTION public.e2e_reject_diary_enqueue()
    `);
  }
  async function dropFaults() {
    await harness.db.execute(
      sql`DROP TRIGGER IF EXISTS e2e_reject_diary_enqueue ON dbos.workflow_status`,
    );
    await harness.db.execute(
      sql`DROP FUNCTION IF EXISTS public.e2e_reject_diary_enqueue()`,
    );
    await harness.db.execute(
      sql`DROP TRIGGER IF EXISTS e2e_reject_embedding_write ON diary_entries`,
    );
    await harness.db.execute(
      sql`DROP FUNCTION IF EXISTS public.e2e_reject_embedding_write()`,
    );
  }

  afterEach(async () => {
    await dropFaults();
    const pending = await harness.db.execute(sql`
      SELECT workflow_uuid FROM dbos.workflow_status WHERE name = 'diary.embed'
      AND inputs LIKE '%review-proof:%' AND status IN ('DELAYED','ENQUEUED','PENDING')
    `);
    if (pending.rows.length) {
      await dbos.cancelWorkflows(
        pending.rows.map((r) => String(r.workflow_uuid)),
      );
    }
    for (const id of entries.splice(0)) {
      await deleteDiaryEntryById({
        client,
        auth: () => agent.accessToken,
        path: { entryId: id },
      });
    }
  });
  afterAll(async () => {
    await dbos?.destroy();
    await harness?.teardown();
  });

  it('rolls back a create when its embedding enqueue fails', async () => {
    await rejectEnqueue();
    const { response } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: { content: 'Create must roll back', title: ENQUEUE_MARKER },
    });
    expect(response?.status).toBe(500);
    const rows = await harness.db
      .select({ id: diaryEntries.id })
      .from(diaryEntries)
      .where(
        and(
          eq(diaryEntries.diaryId, agent.privateDiaryId),
          eq(diaryEntries.title, ENQUEUE_MARKER),
        ),
      );
    entries.push(...rows.map((r) => r.id));
    expect(rows).toEqual([]);
  });

  it('rolls back content, CID and vector invalidation when update enqueue fails', async () => {
    const entry = await create('Original content', 'review-proof:original');
    await pollUntil(() => indexed([entry.id]), Boolean, {
      label: 'initial vector',
    });
    await rejectEnqueue();
    const { response } = await updateDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry.id },
      body: { content: 'Rejected edit', title: ENQUEUE_MARKER },
    });
    expect(response?.status).toBe(500);
    const { data: saved, error } = await getDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry.id },
    });
    expect(error).toBeUndefined();
    expect(saved!.content).toBe(entry.content);
    expect(saved!.title).toBe(entry.title);
    expect(saved!.contentHash).toBe(entry.contentHash);
    expect(await indexed([entry.id])).toBe(true);
  });

  it('bounds permanent failures, then indexes after explicit operator resubmission', async () => {
    await harness.db.execute(sql`
      CREATE OR REPLACE FUNCTION public.e2e_reject_embedding_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic embedding persistence failure'; END $$
    `);
    await harness.db.execute(sql`
      CREATE TRIGGER e2e_reject_embedding_write BEFORE UPDATE OF embedding ON diary_entries
      FOR EACH ROW WHEN (NEW.title = 'review-proof:permanent-failure' AND NEW.embedding IS NOT NULL)
      EXECUTE FUNCTION public.e2e_reject_embedding_write()
    `);
    const entry = await create(
      'Preserve acknowledged content through persistent failure',
      PERMANENT_MARKER,
    );
    // Advance persisted deadlines through the SDK, without a production test flag
    // or waiting through twenty minutes of exponential backoff in CI.
    const advanced = new Set<string>();
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      const delayed = await pollUntil(
        async () =>
          (await jobs(entry.id)).find(
            (j) => j.status === 'DELAYED' && !advanced.has(j.workflow_uuid),
          ),
        Boolean,
        { label: `retry ${attempt}`, maxAttempts: 80, intervalMs: 50 },
      );
      advanced.add(delayed!.workflow_uuid);
      await dbos.setWorkflowDelay(delayed!.workflow_uuid, {
        delayUntilEpochMS: Date.now(),
      });
    }
    await expect
      .poll(
        async () => (await jobs(entry.id)).some((j) => j.status === 'ERROR'),
        { timeout: 10000 },
      )
      .toBe(true);
    const terminal = await jobs(entry.id);
    expect(terminal).toHaveLength(MAX_ATTEMPTS);
    expect(terminal.filter((j) => j.status === 'ERROR')).toHaveLength(1);
    expect(terminal.every((j) => ['SUCCESS', 'ERROR'].includes(j.status))).toBe(
      true,
    );
    const { data: readable } = await getDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry.id },
    });
    expect(readable!.contentHash).toBe(entry.contentHash);
    expect(await indexed([entry.id])).toBe(false);
    await dropFaults();
    const retryId = randomUUID();
    await dbos.enqueue(
      {
        workflowName: 'diary.embed',
        queueName: 'diary-embeddings',
        workflowID: `diary-embedding:${retryId}:0`,
      },
      {
        id: entry.id,
        content: entry.content,
        title: entry.title,
        tags: entry.tags,
      },
      retryId,
      0,
    );
    await pollUntil(() => indexed([entry.id]), Boolean, {
      label: 'operator resubmission',
    });
    expect(
      (await jobs(entry.id)).filter((j) => j.status === 'ERROR'),
    ).toHaveLength(1);
  }, 45000);

  it('serves semantic queries before a write backlog drains with one shared worker', async () => {
    const queue = await harness.db.execute(
      sql`SELECT concurrency FROM dbos.queues WHERE name = 'diary-embeddings'`,
    );
    expect(Number(queue.rows[0].concurrency)).toBe(1);
    const probe = await create(
      'Octopuses solve puzzles through distributed neural processing.',
      'review-proof:semantic-probe',
    );
    await pollUntil(() => indexed([probe.id]), Boolean, {
      label: 'semantic probe',
    });
    async function search() {
      const started = performance.now();
      const { data, error } = await searchDiary({
        client,
        auth: () => agent.accessToken,
        body: {
          diaryId: agent.privateDiaryId,
          query: 'cephalopod intelligence',
          limit: 10,
        },
      });
      expect(error).toBeUndefined();
      const result = data as unknown as { results: { id: string }[] };
      // Neither query word appears in the corpus: FTS-only fallback cannot pass.
      expect(result.results.some((r) => r.id === probe.id)).toBe(true);
      return performance.now() - started;
    }
    await search(); // Exclude the first query shape/model warmup from timings.
    const baseline: number[] = [];
    for (let i = 0; i < 20; i++) baseline.push(await search());
    const content =
      'Regional finance reporting tracks invoices, accounting balances, and quarterly sales. '
        .repeat(110)
        .slice(0, 8192);
    const backlog: Awaited<ReturnType<typeof create>>[] = [];
    for (let batch = 0; batch < 8; batch++) {
      backlog.push(
        ...(await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            create(
              `${content.slice(0, 8150)}\nRecord ${batch * 10 + i}`,
              'review-proof:backlog',
            ),
          ),
        )),
      );
    }
    const ids = backlog.map((e) => e.id);
    const pending = async () =>
      (
        await harness.db
          .select({ id: diaryEntries.id })
          .from(diaryEntries)
          .where(
            and(inArray(diaryEntries.id, ids), isNull(diaryEntries.embedding)),
          )
      ).length;
    expect(await pending()).toBeGreaterThan(64);
    const loaded: number[] = [];
    for (let i = 0; i < 20; i++) {
      loaded.push(await search());
      expect(await pending()).toBeGreaterThan(0);
    }
    // eslint-disable-next-line no-console -- Captured CI/native-model contention evidence.
    console.info(
      'embedding-contention',
      JSON.stringify({
        workers: 1,
        entries: 80,
        baselineP95Ms: p95(baseline),
        loadedP95Ms: p95(loaded),
        pendingAfterQueries: await pending(),
      }),
    );
    await pollUntil(() => indexed(ids), Boolean, {
      label: 'backlog drain',
      maxAttempts: 240,
      intervalMs: 250,
    });
  }, 90000);
});
