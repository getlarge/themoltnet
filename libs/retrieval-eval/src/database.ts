import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

import {
  agents,
  createDatabase,
  createDiaryEntryRepository,
  diaries,
  diaryEntries,
  runMigrations,
  teams,
} from '@moltnet/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';

import { image, weights } from './config.js';
import { type Dataset, trialDate } from './dataset.js';
import { hash } from './hash.js';
import type { Ranking } from './metrics.js';
export async function executeTrials(
  d: Dataset,
  vectors: { entryVectors: number[][]; queryVectors: number[][] },
  topKs: number[],
  repeats: number,
  onTrial: (r: Ranking) => Promise<void>,
  onReady?: (metadata: unknown) => Promise<void>,
) {
  const container = await new PostgreSqlContainer(image).start();
  let connection: ReturnType<typeof createDatabase> | undefined;
  try {
    const uri = container.getConnectionUri();
    await runMigrations(uri);
    connection = createDatabase(uri);
    const { db } = connection;
    const version = await db.execute(sql`SELECT version() AS version`);
    const definition = await db.execute(
      sql`SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname='diary_search' AND pronamespace='public'::regnamespace`,
    );
    assert.equal(definition.rows.length, 1);
    let referenceTime = '';
    await db.transaction(async (tx) => {
      const repo = createDiaryEntryRepository(tx);
      const clock = await tx.execute(sql`SELECT now() AS reference_time`);
      referenceTime = new Date(
        String(clock.rows[0].reference_time),
      ).toISOString();
      await onReady?.({
        databaseVersion: String(version.rows[0].version),
        searchFunctionHash: hash(definition.rows[0].definition),
        referenceTime,
        image,
      });
      const [agent] = await tx
        .insert(agents)
        .values({
          identityId: '00000000-0000-4000-b001-000000000001',
          publicKey: 'ed25519:integrationtestkey',
          fingerprint: 'A1B2-C3D4-E5F6-1234',
        })
        .returning();
      const [team] = await tx
        .insert(teams)
        .values({ name: 'Test Team', creatorAgentId: agent.id })
        .returning();
      const [diary] = await tx
        .insert(diaries)
        .values({
          creatorAgentId: agent.id,
          teamId: team.id,
          name: 'Retrieval evaluation',
          visibility: 'private',
        })
        .returning();
      const ids = new Map<string, string>();
      for (const [i, e] of d.entries.entries()) {
        const createdAt = trialDate(d, e, referenceTime);
        const entry = await repo.create({
          id: `00000000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`,
          diaryId: diary.id,
          creatorAgentId: agent.id,
          content: e.content,
          title: e.title,
          tags: e.tags,
          importance: e.importance,
          embedding: vectors.entryVectors[i],
          createdAt,
          updatedAt: createdAt,
        });
        ids.set(entry.id, e.id);
      }
      for (let repeat = 1; repeat <= repeats; repeat++)
        for (const weight of weights)
          for (const k of topKs)
            for (const [i, q] of d.queries.entries()) {
              // Search only changes access metadata; creation dates remain transaction-stable.
              await tx
                .update(diaryEntries)
                .set({ lastAccessedAt: null, accessCount: 0 })
                .where(eq(diaryEntries.diaryId, diary.id));
              const results = await repo.search({
                diaryId: diary.id,
                query: q.text,
                embedding: vectors.queryVectors[i],
                limit: k,
                ...weight,
              });
              assert(results.length <= k);
              assert(results.every((e) => e.diaryId === diary.id));
              // Drain repository fire-and-forget updates before resetting the next trial.
              const deadline = Date.now() + 5000;
              while (results.length) {
                const counts = await tx
                  .select({
                    total: sql<number>`coalesce(sum(access_count),0)::int`,
                  })
                  .from(diaryEntries)
                  .where(eq(diaryEntries.diaryId, diary.id));
                if (counts[0].total === results.length) break;
                if (Date.now() > deadline)
                  throw new Error('Access metadata did not settle');
                await setTimeout(10);
              }
              const retrievedIds = results.map((e) => {
                const id = ids.get(e.id);
                assert(id, 'Unknown entry');
                return id;
              });
              await onTrial({
                repeat,
                configuration: weight.name,
                queryId: q.id,
                k,
                retrievedIds,
              });
            }
    });
    return {
      databaseVersion: String(version.rows[0].version),
      searchFunctionHash: hash(definition.rows[0].definition),
      referenceTime,
      image,
    };
  } finally {
    try {
      await connection?.pool.end();
    } finally {
      await container.stop();
    }
  }
}
