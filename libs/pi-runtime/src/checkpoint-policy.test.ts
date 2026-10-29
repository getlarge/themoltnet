/** Synthetic Pi 1.4 representation probe; not an agent/network latency benchmark.
 * CHECKPOINT_BENCH=1 enables the larger measurement matrix and JSON output.
 */
import { writeFileSync } from 'node:fs';

import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import {
  createSession,
  defineDocFamily,
  type DocumentId,
  type JsonObject,
} from '@earendil-works/pi-durable';
import { describe, expect, it, vi } from 'vitest';

import { remoteLog } from '../__tests__/durable-log.js';
import { ApiDurableStorage, type RuntimeCommit } from './durable-storage.js';

type Policy =
  | 'disabled'
  | 'completion'
  | 'periodic32'
  | 'periodic64'
  | 'pending32';
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
// Serialized retained content is a reproducible memory proxy, not JS heap size.
// Pi 1.4 current-only documents keep the newest base and its following deltas.
function retainedContentBytes(commits: RuntimeCommit[], id: DocumentId) {
  let total = 0;
  for (const write of commits.flatMap((c) => c.writes)) {
    if (
      (write.type === 'document.create' && write.record.id === id) ||
      (write.type === 'document.change' && write.id === id)
    ) {
      if (write.content.kind === 'base') total = 0;
      total += bytes(write.content);
    }
  }
  return total;
}
const initial = (environmentBytes: number) => ({
  conversationId: 2,
  startedAt: 1,
  baseline: { inputTokens: 0, outputTokens: 0 },
  submission: null as JsonObject | null,
  result: null as JsonObject | null,
  environment: { marker: 'x'.repeat(environmentBytes), token: '1' },
  turns: 0,
  reminders: 0,
  invalidFinalMessages: 0,
  finalMessageError: null as string | null,
  lastToolRound: null as string | null,
  outputSource: null as string | null,
  bashTimeouts: 0,
});
const definition = (policy: Policy) =>
  defineDocFamily({
    kind: 'moltnet.attempt',
    version: 1,
    scope: 'session',
    family: true,
    initial,
    checkpointWhen: (value, _ops, info) =>
      policy !== 'disabled' &&
      (value.result !== null ||
        (policy.startsWith('periodic') &&
          info.deltasSinceBase >= Number(policy.slice(8)))),
  });
async function fixture(policy: Policy, size = 2048) {
  const log = remoteLog();
  const storage = await ApiDurableStorage.open(log.transport, context);
  const session = createSession(storage);
  const doc = definition(policy);
  await session.commit(async (tx) => {
    await tx.doc(doc, 'task/1', size);
  }, context);
  const created = log.commits
    .flatMap((c) => c.writes)
    .find((w) => w.type === 'document.create');
  if (!created || created.type !== 'document.create')
    throw new Error('Missing document');
  const read = () => storage.document(created.record.id, 'current', context);
  const turn = () =>
    session.commit(async (tx) => {
      const state = await tx.doc(doc, 'task/1', size);
      state.turns++;
      state.lastToolRound = String(state.turns);
    }, context);
  const finish = (outputBytes = 128) =>
    session.commit(async (tx) => {
      const state = await tx.doc(doc, 'task/1', size);
      state.result = {
        status: 'completed',
        output: { summary: 'o'.repeat(outputBytes) },
      };
    }, context);
  return {
    ...log,
    storage,
    session,
    doc,
    read,
    turn,
    finish,
    id: created.record.id,
  };
}

describe('checkpoint representation contract', () => {
  it.each([32, 64] as const)(
    'counts %i stored deltas, ignores no-ops and resets on the next changed commit',
    async (threshold) => {
      const f = await fixture(threshold === 32 ? 'periodic32' : 'periodic64');
      for (let i = 0; i < threshold; i++) await f.turn();
      expect((await f.read())?.deltasSinceBase).toBe(threshold);
      const count = f.commits.length;
      await f.session.commit(async (tx) => {
        await tx.doc(f.doc, 'task/1', 2048);
      }, context);
      expect(f.commits).toHaveLength(count);
      expect((await f.read())?.deltasSinceBase).toBe(threshold);
      await f.turn();
      expect((await f.read())?.deltasSinceBase).toBe(0);
      await f.turn();
      expect((await f.read())?.deltasSinceBase).toBe(1);
      await f.finish();
      const expected = await f.session.snapshot(f.doc, 'task/1', context);
      expect((await f.read())?.deltasSinceBase).toBe(0);
      const immutable = structuredClone(f.commits);
      await f.session.close(context);
      vi.mocked(f.transport.read).mockClear();
      const reopened = await ApiDurableStorage.open(f.transport, context);
      expect(
        (await reopened.document(f.id, 'current', context))?.value,
      ).toEqual(expected);
      expect(expected?.turns).toBe(threshold + 2);
      expect(expected?.result?.status).toBe('completed');
      expect(f.commits).toEqual(immutable);
      expect(f.transport.read).toHaveBeenCalledTimes(
        Math.ceil(immutable.length / 2),
      );
      await reopened.close(context);
    },
  );

  it('exceeds the commit limit with a completion base where executor deltas fit', async () => {
    const sizes: number[] = [];
    for (const policy of ['disabled', 'completion'] as const) {
      const f = await fixture(policy, 128);
      // Freeform summary has no maxLength. The executor first records submission,
      // then materializes the same output in result in a separate commit.
      const summary = 'x'.repeat(1024 * 1024 - 4096);
      await f.session.commit(async (tx) => {
        const state = await tx.doc(f.doc, 'task/1', 0);
        state.submission = { summary };
        state.outputSource = 'submit_tool';
      }, context);
      expect(
        bytes({ format: 'pi-durable.v1', writes: f.commits.at(-1)!.writes }),
      ).toBeLessThan(1024 * 1024);
      await f.session.commit(async (tx) => {
        (await tx.doc(f.doc, 'task/1', 0)).result = {
          status: 'completed',
          output: { summary },
          outputCid: 'fixture',
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: 1,
        };
      }, context);
      sizes.push(
        bytes({ format: 'pi-durable.v1', writes: f.commits.at(-1)!.writes }),
      );
      await f.session.close(context);
    }
    expect(sizes[0]).toBeLessThan(1024 * 1024);
    expect(sizes[1]).toBeGreaterThan(1024 * 1024);
  });
});

it.skipIf(process.env.CHECKPOINT_BENCH !== '1')(
  'measures checkpoint tradeoffs',
  async () => {
    const results: unknown[] = [];
    for (const turns of [30, 500])
      for (const environmentBytes of [2048, 32768])
        for (const policy of [
          'disabled',
          'completion',
          'periodic32',
          'periodic64',
        ] as const) {
          const f = await fixture(policy, environmentBytes);
          const cpu = process.cpuUsage();
          for (let n = 0; n < turns; n++) await f.turn();
          const activeTail = (await f.read())!.deltasSinceBase;
          await f.session.commit(async (tx) => {
            const state = await tx.doc(f.doc, 'task/1', environmentBytes);
            state.submission = { summary: 'o'.repeat(environmentBytes) };
            state.outputSource = 'submit_tool';
          }, context);
          await f.finish(environmentBytes);
          const final = (await f.read())!;
          const loop = async (fn: () => Promise<unknown>) => {
            const start = performance.now();
            for (let n = 0; n < 1000; n++) await fn();
            return performance.now() - start;
          };
          const warmSnapshotMs = await loop(() =>
            f.session.snapshot(f.doc, 'task/1', context),
          );
          const directStorageMs = await loop(f.read);
          const writeBytes = f.commits.reduce(
            (sum, c) =>
              sum + bytes({ format: 'pi-durable.v1', writes: c.writes }),
            0,
          );
          const cpuMicros = process.cpuUsage(cpu);
          await f.session.close(context);
          vi.mocked(f.transport.read).mockClear();
          const reopenStart = performance.now();
          const reopened = await ApiDurableStorage.open(f.transport, context);
          const reopenMs = performance.now() - reopenStart;
          const coldSession = createSession(reopened);
          const coldStart = performance.now();
          await coldSession.snapshot(f.doc, 'task/1', context);
          const coldSnapshotMs = performance.now() - coldStart;
          expect(
            (await reopened.document(f.id, 'current', context))?.value,
          ).toEqual(final.value);
          results.push({
            policy,
            turns,
            environmentBytes,
            outputBytes: environmentBytes,
            activeTail,
            finalTail: final.deltasSinceBase,
            retainedRevisionCount: final.deltasSinceBase + 1,
            retainedContentBytes: retainedContentBytes(f.commits, f.id),
            currentValueBytes: bytes(final.value),
            commits: f.commits.length,
            writeBytes,
            apiReadCalls: vi.mocked(f.transport.read).mock.calls.length,
            warmSnapshotMs,
            coldSnapshotMs,
            directStorageMs,
            reopenMs,
            cpuMicros,
            heapUsed: process.memoryUsage().heapUsed,
          });
          await reopened.close(context);
        }
    writeFileSync(
      '/tmp/checkpoint-policy-results.json',
      JSON.stringify(
        {
          scope:
            'Synthetic attempt shapes; 1000 warm Session snapshots and direct storage reads; in-process paged transport. Heap is process-wide, unforced GC and includes immutable fixture logs; not retained document memory or production latency.',
          results,
        },
        null,
        2,
      ),
    );
  },
  120000,
);

it('bounds default child updates but leaves exhausted children without a completion base', async () => {
  for (const policy of [
    'disabled',
    'completion',
    'periodic32',
    'periodic64',
    'pending32',
  ] as const) {
    const log = remoteLog();
    const storage = await ApiDurableStorage.open(log.transport, context);
    const session = createSession(storage);
    const child = defineDocFamily({
      kind: 'moltnet.subagent',
      version: 1,
      scope: 'session',
      family: true,
      initial: (_seed: null) => ({
        output: null as JsonObject | null,
        turns: 0,
      }),
      checkpointWhen: (value, _ops, info) =>
        policy === 'pending32'
          ? value.output === null && info.deltasSinceBase >= 32
          : policy !== 'disabled' &&
            (value.output !== null ||
              (policy.startsWith('periodic') &&
                info.deltasSinceBase >= Number(policy.slice(8)))),
    });
    await session.commit(async (tx) => {
      await tx.doc(child, 'child', null);
    }, context);
    const create = log.commits
      .flatMap((c) => c.writes)
      .find((w) => w.type === 'document.create');
    if (!create || create.type !== 'document.create')
      throw new Error('Missing child');
    for (let i = 0; i < 30; i++)
      await session.commit(async (tx) => {
        const state = await tx.doc(child, 'child', null);
        if (state.turns < 30) state.turns++;
      }, context);
    const count = log.commits.length;
    await session.commit(async (tx) => {
      const state = await tx.doc(child, 'child', null);
      if (state.turns < 30) state.turns++;
    }, context);
    expect(log.commits).toHaveLength(count);
    expect(
      (await storage.document(create.record.id, 'current', context))
        ?.deltasSinceBase,
    ).toBe(30);
    expect(
      (await session.snapshot(child, 'child', context))?.output,
    ).toBeNull();
    await session.commit(async (tx) => {
      (await tx.doc(child, 'child', null)).output = { summary: 'done' };
    }, context);
    expect(
      (await storage.document(create.record.id, 'current', context))
        ?.deltasSinceBase,
    ).toBe(policy === 'disabled' || policy === 'pending32' ? 31 : 0);
    await session.close(context);
  }
});

it.skipIf(process.env.CHECKPOINT_BENCH !== '1')(
  'measures child checkpoint tradeoffs',
  async () => {
    const results: unknown[] = [];
    for (const turns of [30, 500])
      for (const outputBytes of [128, 32768])
        for (const policy of [
          'disabled',
          'completion',
          'periodic32',
          'periodic64',
          'pending32',
        ] as const) {
          const log = remoteLog();
          const storage = await ApiDurableStorage.open(log.transport, context);
          const session = createSession(storage);
          const child = defineDocFamily({
            kind: 'moltnet.subagent',
            version: 1,
            scope: 'session',
            family: true,
            initial: (_seed: null) => ({
              output: null as JsonObject | null,
              turns: 0,
            }),
            checkpointWhen: (value, _ops, info) =>
              policy === 'pending32'
                ? value.output === null && info.deltasSinceBase >= 32
                : policy !== 'disabled' &&
                  (value.output !== null ||
                    (policy.startsWith('periodic') &&
                      info.deltasSinceBase >= Number(policy.slice(8)))),
          });
          await session.commit(async (tx) => {
            await tx.doc(child, 'child', null);
          }, context);
          const create = log.commits
            .flatMap((c) => c.writes)
            .find((w) => w.type === 'document.create');
          if (!create || create.type !== 'document.create')
            throw new Error('Missing child');
          const cpuStart = process.cpuUsage();
          for (let n = 0; n < turns; n++)
            await session.commit(async (tx) => {
              (await tx.doc(child, 'child', null)).turns++;
            }, context);
          const activeTail = (await storage.document(
            create.record.id,
            'current',
            context,
          ))!.deltasSinceBase;
          await session.commit(async (tx) => {
            (await tx.doc(child, 'child', null)).output = {
              summary: 'o'.repeat(outputBytes),
            };
          }, context);
          const final = (await storage.document(
            create.record.id,
            'current',
            context,
          ))!;
          const loop = async (fn: () => Promise<unknown>) => {
            const start = performance.now();
            for (let n = 0; n < 1000; n++) await fn();
            return performance.now() - start;
          };
          const warmSnapshotMs = await loop(() =>
            session.snapshot(child, 'child', context),
          );
          const directStorageMs = await loop(() =>
            storage.document(create.record.id, 'current', context),
          );
          const cpuMicros = process.cpuUsage(cpuStart);
          await session.close(context);
          vi.mocked(log.transport.read).mockClear();
          const start = performance.now();
          const reopened = await ApiDurableStorage.open(log.transport, context);
          const reopenMs = performance.now() - start;
          const coldSession = createSession(reopened);
          const coldStart = performance.now();
          expect(await coldSession.snapshot(child, 'child', context)).toEqual(
            final.value,
          );
          const coldSnapshotMs = performance.now() - coldStart;
          results.push({
            policy,
            turns,
            outputBytes,
            activeTail,
            finalTail: final.deltasSinceBase,
            retainedRevisionCount: final.deltasSinceBase + 1,
            retainedContentBytes: retainedContentBytes(
              log.commits,
              create.record.id,
            ),
            currentValueBytes: bytes(final.value),
            commits: log.commits.length,
            writeBytes: log.commits.reduce(
              (sum, c) =>
                sum + bytes({ format: 'pi-durable.v1', writes: c.writes }),
              0,
            ),
            apiReadCalls: vi.mocked(log.transport.read).mock.calls.length,
            warmSnapshotMs,
            directStorageMs,
            coldSnapshotMs,
            reopenMs,
            cpuMicros,
            heapUsed: process.memoryUsage().heapUsed,
          });
          await coldSession.close(context);
        }
    writeFileSync(
      '/tmp/checkpoint-child-results.json',
      JSON.stringify(
        {
          scope:
            'Synthetic child shapes; 30 default turns vs explicitly increased 500-turn cap; same measurement limitations as attempt probe.',
          results,
        },
        null,
        2,
      ),
    );
  },
  120000,
);

it('an output-null child checkpoint still adds seven bytes to the aggregate commit', async () => {
  const log = remoteLog();
  const storage = await ApiDurableStorage.open(log.transport, context);
  const session = createSession(storage);
  const child = defineDocFamily({
    kind: 'moltnet.subagent',
    version: 1,
    scope: 'session',
    family: true,
    initial: (_seed: null) => ({ output: null, turns: 0 }),
    checkpointWhen: () => false,
  });
  await session.commit(async (tx) => {
    await tx.doc(child, 'child', null);
  }, context);
  for (const turns of [9, 10, 30, 32, 64, 500, Number.MAX_SAFE_INTEGER]) {
    await session.commit(async (tx) => {
      (await tx.doc(child, 'child', null)).turns = turns;
    }, context);
    const writes = log.commits.at(-1)!.writes;
    const baseWrites = writes.map((write) =>
      write.type === 'document.change'
        ? {
            ...write,
            content: {
              version: 1,
              kind: 'base',
              value: { output: null, turns },
            },
          }
        : write,
    );
    expect(
      bytes({ format: 'pi-durable.v1', writes: baseWrites }) -
        bytes({ format: 'pi-durable.v1', writes }),
    ).toBe(7);
  }
  await session.close(context);
});

it.each(['next-turn', 'immediate-output', 'completed-legacy'] as const)(
  'upgrades a legacy child history through %s without rewriting immutable commits',
  async (path) => {
    const log = remoteLog();
    const family = (enabled: boolean) =>
      defineDocFamily({
        kind: 'moltnet.subagent',
        version: 1,
        scope: 'session',
        family: true,
        initial: (_seed: null) => ({
          output: null as JsonObject | null,
          turns: 0,
        }),
        checkpointWhen: (value, _ops, info) =>
          enabled && value.output === null && info.deltasSinceBase >= 32,
      });
    const legacy = family(false);
    const original = await ApiDurableStorage.open(log.transport, context);
    const oldSession = createSession(original);
    await oldSession.commit(async (tx) => {
      await tx.doc(legacy, 'child', null);
    }, context);
    for (let turn = 0; turn < 41; turn++)
      await oldSession.commit(async (tx) => {
        (await tx.doc(legacy, 'child', null)).turns++;
      }, context);
    if (path === 'completed-legacy')
      await oldSession.commit(async (tx) => {
        (await tx.doc(legacy, 'child', null)).output = { verdict: 'done' };
      }, context);
    const create = log.commits
      .flatMap((c) => c.writes)
      .find((w) => w.type === 'document.create');
    if (!create || create.type !== 'document.create')
      throw new Error('Missing child');
    const id = create.record.id;
    const before = await original.document(id, 'current', context);
    expect(before?.deltasSinceBase).toBe(path === 'completed-legacy' ? 42 : 41);
    const immutable = structuredClone(log.commits);
    await oldSession.close(context);

    const upgraded = family(true);
    const reopened = await ApiDurableStorage.open(log.transport, context);
    const session = createSession(reopened);
    expect(await session.snapshot(upgraded, 'child', context)).toEqual(
      before?.value,
    );
    // Loading a new definition and committing a no-op cannot checkpoint history.
    await session.commit(async (tx) => {
      await tx.doc(upgraded, 'child', null);
    }, context);
    expect(log.commits).toEqual(immutable);
    expect(await reopened.document(id, 'current', context)).toEqual(before);

    if (path !== 'completed-legacy')
      await session.commit(async (tx) => {
        const state = await tx.doc(upgraded, 'child', null);
        if (path === 'next-turn') state.turns++;
        else state.output = { verdict: 'done' };
      }, context);
    const final = await reopened.document(id, 'current', context);
    expect(final?.value).toEqual({
      turns: path === 'next-turn' ? 42 : 41,
      output: path === 'next-turn' ? null : { verdict: 'done' },
    });
    expect(final?.deltasSinceBase).toBe(path === 'next-turn' ? 0 : 42);
    expect(log.commits.slice(0, immutable.length)).toEqual(immutable);
    expect(log.commits).toHaveLength(
      immutable.length + (path === 'completed-legacy' ? 0 : 1),
    );
    if (path !== 'completed-legacy')
      expect(log.commits.at(-1)?.writes).toEqual([
        expect.objectContaining({
          type: 'document.change',
          id,
          content: expect.objectContaining({
            kind: path === 'next-turn' ? 'base' : 'delta',
          }),
        }),
      ]);
    await session.close(context);
    const history = structuredClone(log.commits);
    const recovered = await ApiDurableStorage.open(log.transport, context);
    expect(await recovered.document(id, 'current', context)).toEqual(final);
    expect(log.commits).toEqual(history);
    await recovered.close(context);
  },
);
