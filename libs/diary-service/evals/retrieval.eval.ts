import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  agents,
  createDatabase,
  createDiaryEntryRepository,
  diaries,
  diaryEntries,
  runMigrations,
  teams,
} from '@moltnet/database';
import { createEmbeddingService } from '@moltnet/embedding-service';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { buildEmbeddingText } from '../src/diary-service.js';
import {
  retrievalEntries,
  retrievalQueries,
  SOURCE_REVISION,
} from './fixtures/retrieval-corpus.js';
import {
  calculateRetrievalMetrics,
  type RetrievalMetrics,
} from './retrieval-metrics.js';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outputDir = new URL('../../../.cache/retrieval-eval/', import.meta.url);
const modelId = 'Xenova/e5-small-v2';
const quantization = 'q8';
const image = 'pgvector/pgvector:pg16';
const repeats = 2;
const topKs = [1, 3, 5];
const weights = [
  { name: 'relevance', wRelevance: 1, wRecency: 0, wImportance: 0 },
  { name: 'recency', wRelevance: 1, wRecency: 0.2, wImportance: 0 },
  { name: 'importance', wRelevance: 1, wRecency: 0, wImportance: 0.2 },
  { name: 'combined', wRelevance: 1, wRecency: 0.2, wImportance: 0.2 },
] as const;

// Retain the existing ranking fixtures' historical dates. Other entries use
// transaction now(), as they do when created in the original tests.
// Reset lastAccessedAt to null so these same dates drive every comparison.
const historicalDates: Record<string, string> = {
  fishing: '2024-01-01T00:00:00Z',
  angling: '2024-01-01T00:00:00Z',
  'ranking-incident': '2024-01-01T00:00:00Z',
  'search-ui-copy': '2025-01-01T00:00:00Z',
  'retrieval-tuning': '2025-06-01T00:00:00Z',
};

interface Trial {
  repeat: number;
  configuration: string;
  queryId: string;
  retrievedIds: string[];
  metrics: RetrievalMetrics;
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

it('measures the unchanged hybrid search on the labeled corpus', async () => {
  const model = createEmbeddingService({
    modelId,
    quantization,
    allowRemoteModels: false,
    cacheDir: process.env.RETRIEVAL_MODEL_CACHE,
  });

  // Fail on missing model or invalid embeddings. Never fall back to FTS-only.
  const entryVectors: number[][] = [];
  for (const entry of retrievalEntries) {
    entryVectors.push(
      await model.embedPassage(
        buildEmbeddingText(
          entry.content,
          entry.tags ? [...entry.tags] : undefined,
          entry.title,
        ),
      ),
    );
  }
  const queryVectors: number[][] = [];
  for (const query of retrievalQueries) {
    queryVectors.push(await model.embedQuery(query.query));
  }
  for (const vector of [...entryVectors, ...queryVectors]) {
    expect(vector).toHaveLength(384);
    expect(vector.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 5);
  }

  const container = await new PostgreSqlContainer(image).start();
  let connection: ReturnType<typeof createDatabase> | undefined;
  const trials: Trial[] = [];
  let databaseVersion = '';
  let searchFunctionHash = '';
  let referenceTime = '';

  try {
    // Only the URI from our new disposable container is used, never DATABASE_URL.
    const uri = container.getConnectionUri();
    await runMigrations(uri);
    connection = createDatabase(uri);
    const { db } = connection;
    const version = await db.execute(sql`SELECT version() AS version`);
    databaseVersion = String(version.rows[0].version);
    const definition = await db.execute(sql`
      SELECT pg_get_functiondef(oid) AS definition FROM pg_proc
      WHERE proname = 'diary_search' AND pronamespace = 'public'::regnamespace
    `);
    expect(definition.rows).toHaveLength(1);
    searchFunctionHash = sha256(String(definition.rows[0].definition));

    // One transaction freezes PostgreSQL now() across every trial. Sequential
    // searches and an awaited access-count check drain fire-and-forget updates
    // before the next metadata reset. No scoring SQL is copied or changed.
    await db.transaction(async (tx) => {
      const repo = createDiaryEntryRepository(tx);
      const clock = await tx.execute(sql`SELECT now() AS reference_time`);
      referenceTime = new Date(
        String(clock.rows[0].reference_time),
      ).toISOString();

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
          name: 'Test Diary',
          visibility: 'private',
        })
        .returning();

      const entryIdMap = new Map<string, string>();
      const dateById = new Map<string, Date>();
      for (const [index, fixture] of retrievalEntries.entries()) {
        const createdAt = new Date(
          historicalDates[fixture.id] ?? referenceTime,
        );
        const entry = await repo.create({
          id: `00000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
          diaryId: diary.id,
          creatorAgentId: agent.id,
          content: fixture.content,
          title: fixture.title,
          tags: fixture.tags ? [...fixture.tags] : undefined,
          importance: fixture.importance,
          embedding: entryVectors[index],
          createdAt,
          updatedAt: createdAt,
        });
        entryIdMap.set(entry.id, fixture.id);
        dateById.set(entry.id, createdAt);
      }

      for (let repeat = 1; repeat <= repeats; repeat++) {
        for (const weight of weights) {
          for (const k of topKs) {
            for (const [queryIndex, query] of retrievalQueries.entries()) {
              for (const [id, createdAt] of dateById) {
                await tx
                  .update(diaryEntries)
                  .set({ createdAt, lastAccessedAt: null, accessCount: 0 })
                  .where(eq(diaryEntries.id, id));
              }
              const results = await repo.search({
                diaryId: diary.id,
                query: query.query,
                embedding: queryVectors[queryIndex],
                limit: k,
                wRelevance: weight.wRelevance,
                wRecency: weight.wRecency,
                wImportance: weight.wImportance,
              });
              expect(results.length).toBeLessThanOrEqual(k);
              expect(results.every((entry) => entry.diaryId === diary.id)).toBe(
                true,
              );
              if (results.length > 0) {
                await expect
                  .poll(
                    async () => {
                      const counts = await tx
                        .select({ total: sql<number>`sum(access_count)::int` })
                        .from(diaryEntries)
                        .where(eq(diaryEntries.diaryId, diary.id));
                      return counts[0].total;
                    },
                    { timeout: 5_000 },
                  )
                  .toBe(results.length);
              }
              const retrievedIds = results.map((entry) => {
                const id = entryIdMap.get(entry.id);
                if (!id) throw new Error('Search returned an unknown entry');
                return id;
              });
              trials.push({
                repeat,
                configuration: weight.name,
                queryId: query.id,
                retrievedIds,
                metrics: calculateRetrievalMetrics({
                  retrievedIds,
                  relevantIds: query.relevantIds,
                  corpusIds: retrievalEntries.map((entry) => entry.id),
                  k,
                }),
              });
            }
          }
        }
      }
    });
  } finally {
    try {
      await connection?.pool.end();
    } finally {
      await container.stop();
    }
  }

  const expectedTrials =
    repeats * weights.length * topKs.length * retrievalQueries.length;
  expect(trials).toHaveLength(expectedTrials);
  const repeatDifferences = trials.filter((trial) => {
    if (trial.repeat === 1) return false;
    const first = trials.find(
      (other) =>
        other.repeat === 1 &&
        other.configuration === trial.configuration &&
        other.queryId === trial.queryId &&
        other.metrics.k === trial.metrics.k,
    );
    return (
      JSON.stringify(first?.retrievedIds) !== JSON.stringify(trial.retrievedIds)
    );
  });
  // Preserve evidence even if repeatability fails. Quality scores are NEVER
  // compared to a desired pass mark; low quality is a valid measured result.
  const summary = weights.flatMap((weight) =>
    topKs.map((k) => {
      const selected = trials.filter(
        (trial) => trial.configuration === weight.name && trial.metrics.k === k,
      );
      const answerable = selected.filter(
        (trial) => trial.metrics.recallAtK !== null,
      );
      const noMatch = selected.filter(
        (trial) => trial.metrics.recallAtK === null,
      );
      return {
        configuration: weight.name,
        k,
        answerableTrials: answerable.length,
        meanPrecisionAtK:
          answerable.reduce(
            (sum, trial) => sum + trial.metrics.precisionAtK,
            0,
          ) / answerable.length,
        meanRecallAtK:
          answerable.reduce(
            (sum, trial) => sum + (trial.metrics.recallAtK ?? 0),
            0,
          ) / answerable.length,
        meanFalsePositives:
          answerable.reduce(
            (sum, trial) => sum + trial.metrics.falsePositives,
            0,
          ) / answerable.length,
        noMatchMeanFalsePositives:
          noMatch.reduce(
            (sum, trial) => sum + trial.metrics.falsePositives,
            0,
          ) / noMatch.length,
        noMatchEmptyResultRate:
          noMatch.filter((trial) => trial.metrics.retrievedCount === 0).length /
          noMatch.length,
      };
    }),
  );
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  }).trim();
  const dirty =
    execFileSync('git', ['status', '--porcelain'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    }).trim().length > 0;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision,
    dirty,
    sourceRevision: SOURCE_REVISION,
    datasetHash: sha256(JSON.stringify({ retrievalEntries, retrievalQueries })),
    runnerHash: sha256(await readFile(fileURLToPath(import.meta.url), 'utf8')),
    metricsHash: sha256(
      await readFile(
        new URL('./retrieval-metrics.ts', import.meta.url),
        'utf8',
      ),
    ),
    embeddingHash: sha256(JSON.stringify({ entryVectors, queryVectors })),
    model: { modelId, quantization, dimensions: 384, remoteDownloads: false },
    nodeVersion: process.version,
    platform: process.platform,
    databaseVersion,
    searchFunctionHash,
    image,
    referenceTime,
    corpusSize: retrievalEntries.length,
    queryCount: retrievalQueries.length,
    repeats,
    topKs,
    weights,
    historicalDates,
    defaultImportance: 5,
    repeatDifferences,
    summary,
    trials,
  };
  await mkdir(outputDir, { recursive: true });
  const output = new URL(`baseline-${Date.now()}.json`, outputDir);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
  process.stdout.write(`Retrieval results: ${fileURLToPath(output)}\n`);
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  expect(
    repeatDifferences,
    'Repeated queries changed order or membership',
  ).toEqual([]);
}, 180_000);
