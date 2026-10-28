/**
 * Cold/warm Durable conversation-read benchmark.
 *
 * Builds a realistic Pi Durable commit history (streamed live-generation
 * deltas, assistant entries, tool results), stores it as checksummed commit
 * objects, then lists conversations through the real runtime store and
 * conversation services. Storage, Keto and Postgres are simulated with fixed
 * latencies so the I/O shape, not the hardware, dominates.
 *
 * Best case, not a production prediction: every fetch takes exactly the same
 * time and objects are a few KB, so neither event-loop CPU (hashing, parsing)
 * nor head-of-line blocking from ordered delivery shows up here. Production
 * numbers come from the `moltnet.conversation.refresh` span.
 *
 *   pnpm exec nx run @moltnet/runtime-session-service:bench:conversation-read
 *
 * Tunables (env): BENCH_TURNS, BENCH_S3_MS, BENCH_KETO_MS, BENCH_DB_MS,
 * BENCH_TOOL_KB (pads tool results; ~900 approaches the 1 MiB commit limit).
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  createSession,
  defineDocFamily,
  LiveDoc,
  MemoryStorage,
  type StorageWrite,
} from '@earendil-works/pi-durable';
import { KetoNamespace } from '@moltnet/auth';
import { describe, expect, it } from 'vitest';

import { createConversationService } from '../src/conversations.js';
import { createRuntimeStoreService } from '../src/runtime-stores.js';

const context = BACKGROUND_CONTEXT;
const env = (name: string, fallback: number) =>
  Number(process.env[name] ?? fallback);
const S3_MS = env('BENCH_S3_MS', 35);
const KETO_MS = env('BENCH_KETO_MS', 25);
const DB_MS = env('BENCH_DB_MS', 3);
// Extra KB per tool result: ~0 for chat-sized commits, ~900 for near-limit ones.
const TOOL_KB = env('BENCH_TOOL_KB', 0);
const Attempts = defineDocFamily({
  kind: 'moltnet.attempt',
  version: 1,
  scope: 'session',
  family: true,
  checkpointWhen: () => false,
  initial: (conversationId: number) => ({ conversationId }),
});
const input = {
  subjectId: 'agent',
  subjectType: 'agent' as const,
  subjectNs: KetoNamespace.Agent,
  teamId: 'team',
  taskId: 'task',
  attemptN: 1,
};
const text = (n: number) => 'lorem ipsum dolor sit amet '.repeat(n);

async function history(turns: number) {
  const commits: StorageWrite[][] = [];
  class Writer extends MemoryStorage {
    override async commit(writes: readonly StorageWrite[]) {
      const seq = await super.commit(writes, context);
      commits.push(JSON.parse(JSON.stringify(writes)) as StorageWrite[]);
      return seq;
    }
  }
  const session = createSession(new Writer());
  const root = (
    await session.commit(
      (tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }),
      context,
    )
  ).id;
  await session.commit(async (tx) => {
    await tx.doc(Attempts, 'task/1', root);
    await tx.appendEntry(root, {
      kind: 'pi.user',
      model: [{ role: 'user', content: text(40), timestamp: 1 }],
    });
  }, context);
  for (let turn = 0; turn < turns; turn++) {
    // Pi persists streamed partials as live-doc deltas before the final entry.
    for (let delta = 1; delta <= 4; delta++)
      await session.commit(async (tx) => {
        const live = await tx.doc(LiveDoc, root);
        live.generation = {
          attempt: 1,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: text(delta * 20) }],
          } as never,
        };
      }, context);
    await session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, root);
      delete live.generation;
      await tx.appendEntry(root, {
        kind: 'pi.assistant',
        model: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: text(80) }],
            stopReason: 'toolUse',
          } as never,
        ],
      });
      await tx.appendEntry(root, {
        kind: 'pi.tool',
        model: [
          {
            role: 'toolResult',
            content: text(150) + 'x'.repeat(TOOL_KB * 1024),
            timestamp: 2,
          } as never,
        ],
      });
    }, context);
  }
  await session.close(context);
  return commits;
}

async function setup(commits: StorageWrite[][], readConcurrency: number) {
  const objects = new Map<string, Buffer>();
  let gets = 0;
  let inflight = 0;
  let maxInflight = 0;
  const rows: Array<Record<string, unknown>> = [];
  const store = {
    id: 'store',
    teamId: 'team',
    format: 'pi-durable.v1',
    headSeq: 0,
    nextId: 1,
    writerToken: null,
    writerExpiresAt: null,
  };
  const binding = {
    storeId: 'store',
    teamId: 'team',
    taskId: 'task',
    attemptN: 1,
  };
  const db = async <T>(value: T) => {
    await sleep(DB_MS);
    return value;
  };
  const keto = async <T>(value: T) => {
    await sleep(KETO_MS);
    return value;
  };
  const repository = {
    findAttempt: () => db(binding),
    listAttempts: () => db([binding]),
    listCommitTaskIds: () => db(['task']),
    get: () => db({ ...store, writerTaskId: 'task', writerAttemptN: 1 }),
    attemptBounds: () => db({ firstSeq: 1, lastSeq: store.headSeq }),
    listCommits: (_s: string, after: number, limit: number, head: number) =>
      db(
        rows
          .filter((r) => Number(r.seq) > after && Number(r.seq) <= head)
          .slice(0, limit),
      ),
  };
  const storage = {
    getObject: async (key: string, signal?: AbortSignal) => {
      gets++;
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      try {
        await sleep(S3_MS, undefined, { signal });
      } finally {
        inflight--;
      }
      return { body: Readable.from([objects.get(key)!]) };
    },
  };
  for (const [index, writes] of commits.entries()) {
    const bytes = Buffer.from(
      JSON.stringify({ format: 'pi-durable.v1', writes }),
    );
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const objectKey = `k/${index}`;
    objects.set(objectKey, bytes);
    rows.push({
      seq: index + 1,
      commitId: `c${index}`,
      sha256,
      objectKey,
      sizeBytes: bytes.length,
      taskId: 'task',
    });
  }
  store.headSeq = commits.length;
  const permissionChecker = {
    canAccessTeam: () => keto(true),
    canViewTask: () => keto(true),
    canViewTasks: (ids: string[]) => keto(new Map(ids.map((id) => [id, true]))),
  };
  const stores = createRuntimeStoreService({
    repository,
    storage,
    permissionChecker,
    maxBytes: 1024 * 1024,
    readConcurrency,
    transactionRunner: { runInTransaction: (fn: () => unknown) => fn() },
  } as never);
  const service = createConversationService({
    stores,
    repository: repository as never,
    tasks: { findAttempt: () => db({ status: 'completed' }) } as never,
  });
  return {
    service,
    stats: () => ({ gets, maxInflight }),
    totalBytes: [...objects.values()].reduce((n, b) => n + b.length, 0),
  };
}

describe('conversation read benchmark', () => {
  const sizes = (process.env.BENCH_TURNS ?? '10,40,120').split(',').map(Number);
  // 1 is the sequential baseline (the store default); 8 is the conversation
  // route's setting. Same history, same simulated latencies.
  for (const turns of sizes)
    for (const readConcurrency of [1, 8])
      it(
        `cold vs warm list, ${turns} turns, concurrency ${readConcurrency}`,
        { timeout: 120_000 },
        async () => {
          const commits = await history(turns);
          const f = await setup(commits, readConcurrency);
          const gc = global.gc;
          if (!gc) throw new Error('Run with NODE_OPTIONS=--expose-gc');
          gc();
          const heapBefore = process.memoryUsage().heapUsed;
          let peakHeap = heapBefore;
          const sampler = setInterval(() => {
            peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
          }, 2);
          let t = performance.now();
          const cold = await f.service.open(input);
          const coldList = cold.list();
          const coldMs = performance.now() - t;
          clearInterval(sampler);
          // Heap still reachable after the cold read (the replayed reader), not
          // the peak during it.
          gc();
          const heapAfter = process.memoryUsage().heapUsed;
          await cold.close();
          t = performance.now();
          const warm = await f.service.open(input);
          const warmList = warm.list();
          const warmMs = performance.now() - t;
          // Sanity only: the warm reader is the cached cold replica. Ordered
          // replay under concurrency is covered by runtime-stores tests.
          expect(warmList).toEqual(coldList);
          expect(coldList.items).toEqual([
            expect.objectContaining({ kind: 'main' }),
          ]);
          await warm.close();
          await f.service.close();
          const stats = f.stats();
          // The byte budget may hold large commits below the concurrency limit.
          expect(stats.maxInflight).toBeLessThanOrEqual(readConcurrency);
          console.log(
            JSON.stringify({
              turns,
              readConcurrency,
              commits: commits.length,
              storedBytes: f.totalBytes,
              s3Ms: S3_MS,
              ketoMs: KETO_MS,
              dbMs: DB_MS,
              coldMs: Math.round(coldMs),
              warmMs: Math.round(warmMs),
              toolKb: TOOL_KB,
              peakHeapDeltaMiB: +((peakHeap - heapBefore) / 2 ** 20).toFixed(1),
              retainedHeapMiB: +((heapAfter - heapBefore) / 2 ** 20).toFixed(1),
              ...stats,
            }),
          );
        },
      );
});
