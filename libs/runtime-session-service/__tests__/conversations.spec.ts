import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  type ConversationId,
  createSession,
  defineDocFamily,
  LiveDoc,
  MemoryStorage,
  type Seq,
  type StorageWrite,
} from '@earendil-works/pi-durable';
import { KetoNamespace } from '@moltnet/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConversationService } from '../src/conversations.js';

afterEach(() => vi.useRealTimers());

const context = BACKGROUND_CONTEXT;
const input = {
  subjectId: 'agent',
  subjectType: 'agent' as const,
  subjectNs: KetoNamespace.Agent,
  teamId: 'team',
  taskId: 'task',
  attemptN: 1,
};
const Attempts = defineDocFamily({
  kind: 'moltnet.attempt',
  version: 1,
  scope: 'session',
  family: true,
  checkpointWhen: () => false,
  initial: (conversationId: number) => ({ conversationId }),
});
async function fixture() {
  const commits: { seq: number; writes: StorageWrite[] }[] = [];
  class Writer extends MemoryStorage {
    override async commit(writes: readonly StorageWrite[]) {
      const seq = await super.commit(writes, context);
      commits.push({
        seq,
        writes: JSON.parse(JSON.stringify(writes)) as StorageWrite[],
      });
      return seq;
    }
  }
  const writer = new Writer();
  const session = createSession(writer);
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
      model: [{ role: 'user', content: 'hello', timestamp: 1 }],
    });
    const live = await tx.doc(LiveDoc, root);
    live.generation = {
      attempt: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
      } as never,
    };
  }, context);
  let cap: number | undefined;
  let firstSeq = 1;
  let active = true;
  let status = 'running';
  const read = vi.fn(
    async ({
      afterSeq,
      throughSeq,
    }: {
      afterSeq: number;
      throughSeq: number;
    }) => ({
      headSeq: throughSeq,
      count: commits.filter((c) => c.seq > afterSeq && c.seq <= throughSeq)
        .length,
      items: (async function* () {
        for (const c of commits)
          if (c.seq > afterSeq && c.seq <= throughSeq) yield c;
      })(),
    }),
  );
  const deps = {
    stores: { findAttempt: vi.fn(async () => ({ storeId: 'store' })), read },
    repository: {
      attemptBounds: async () => ({ firstSeq, lastSeq: cap ?? commits.length }),
      get: async () => ({
        writerTaskId: 'task',
        writerAttemptN: 1,
        writerExpiresAt: new Date(active ? 5000 : 0),
      }),
    },
    tasks: { findAttempt: async () => ({ status }) },
    now: () => 1000,
  } as unknown as Parameters<typeof createConversationService>[0];
  return {
    service: createConversationService(deps),
    deps,
    writer,
    session,
    commits,
    root: String(root),
    read,
    setFirst: (n: number) => {
      firstSeq = n;
    },
    setCap: (n: number) => {
      cap = n;
    },
    interrupt: () => {
      active = false;
      status = 'failed';
    },
  };
}

describe('read-only Durable conversations', () => {
  it('replays Pi document deltas and reconnects from persisted partials without writing', async () => {
    const f = await fixture();
    const count = f.commits.length;
    const reader = await f.service.open(input);
    expect(reader.list().items).toEqual([
      { conversationId: f.root, parentConversationId: null, kind: 'main' },
    ]);
    const initial = await reader.snapshot(f.root);
    expect(initial.messages.at(-1)).toMatchObject({
      status: 'streaming',
      message: { content: [{ text: 'Hello' }] },
    });
    await f.session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, Number(f.root) as ConversationId);
      live.generation!.message!.content[0] = {
        type: 'text',
        text: 'Hello world',
      };
    }, context);
    await reader.refresh();
    const next = await reader.snapshot(f.root);
    expect(next.cursor).not.toBe(initial.cursor);
    expect(next.messages.at(-1)?.message.content).toEqual([
      { type: 'text', text: 'Hello world' },
    ]);
    const reconnect = await f.service.open(input);
    expect(await reconnect.snapshot(f.root)).toEqual(next);
    expect(f.commits).toHaveLength(count + 1); // Reads never write or recover running tasks.
    await reader.close();
    await reconnect.close();
    await f.session.close(context);
  });

  it('marks a saved partial interrupted after writer loss without discarding it', async () => {
    const f = await fixture();
    const reader = await f.service.open(input);
    const before = await reader.snapshot(f.root);
    f.interrupt();
    await reader.refresh();
    const after = await reader.snapshot(f.root);
    expect(after.cursor).not.toBe(before.cursor);
    expect(after.messages.at(-1)).toMatchObject({
      status: 'interrupted',
      message: { content: [{ text: 'Hello' }] },
    });
    await reader.close();
    await f.session.close(context);
  });

  it('atomically replaces the partial with the completed entry and keeps later attempts out', async () => {
    const f = await fixture();
    const reader = await f.service.open(input);
    await f.session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, Number(f.root) as ConversationId);
      delete live.generation;
      await tx.appendEntry(Number(f.root) as ConversationId, {
        kind: 'pi.assistant',
        model: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Done' }],
            stopReason: 'stop',
          } as never,
        ],
      });
    }, context);
    f.setCap(f.commits.length);
    await f.session.commit(
      (tx) =>
        tx.appendEntry(Number(f.root) as ConversationId, {
          kind: 'pi.user',
          model: [{ role: 'user', content: 'later task', timestamp: 2 }],
        }),
      context,
    );
    await reader.refresh();
    const snapshot = await reader.snapshot(f.root);
    expect(snapshot.messages.map((m) => m.message.content)).toEqual([
      'hello',
      [{ type: 'text', text: 'Done' }],
    ]);
    expect(snapshot.messages.every((m) => m.status === 'completed')).toBe(true);
    await expect(reader.snapshot('9999')).rejects.toMatchObject({
      statusCode: 404,
    });
    await reader.close();
    await f.session.close(context);
  });

  it('paginates fork history while excluding sibling conversations and marking inherited entries', async () => {
    const f = await fixture();
    const entry = await f.session.commit(
      (tx) =>
        tx.appendEntry(Number(f.root) as ConversationId, {
          kind: 'pi.user',
          model: [{ role: 'user', content: 'checkpoint', timestamp: 2 }],
        }),
      context,
    );
    const fork = await f.session.commit(
      (tx) =>
        tx.forkConversation(Number(f.root) as ConversationId, entry.id, {
          ownership: { kind: 'ownerless' },
        }),
      context,
    );
    f.setFirst(f.commits.length + 1);
    await f.session.commit(async (tx) => {
      const state = await tx.doc(Attempts, 'task/1', Number(f.root));
      state.conversationId = fork.id;
      await tx.appendEntry(fork.id, {
        kind: 'pi.user',
        model: [{ role: 'user', content: 'current attempt', timestamp: 3 }],
      });
    }, context);
    const reader = await f.service.open(input);
    expect(reader.list().items.map((c) => c.conversationId)).toEqual([
      String(fork.id),
    ]);
    await expect(reader.snapshot(f.root)).rejects.toMatchObject({
      statusCode: 404,
    });
    const latest = await reader.snapshot(String(fork.id), { limit: 1 });
    expect(latest.messages[0]).toMatchObject({
      inherited: false,
      message: { content: 'current attempt' },
    });
    const older = await reader.snapshot(String(fork.id), {
      limit: 1,
      beforeEntryId: latest.nextBeforeEntryId!,
    });
    expect(older.messages[0]).toMatchObject({
      inherited: true,
      message: { content: 'checkpoint' },
    });
    await reader.close();
    await f.session.close(context);
  });

  it('reauthorizes unchanged heads and rejects corrupt sequence gaps', async () => {
    const f = await fixture();
    const reader = await f.service.open(input);
    f.read.mockRejectedValueOnce(new Error('access revoked'));
    await expect(reader.refresh()).rejects.toThrow('access revoked');
    await reader.close();
    f.commits[0].seq = 9 as Seq;
    await expect(f.service.open(input)).rejects.toThrow(
      'Incomplete conversation history',
    );
    await f.session.close(context);
  });
});

it('reuses idle replay for pagination but reauthorizes every acquisition', async () => {
  const f = await fixture();
  const first = await f.service.open(input);
  const expected = await first.snapshot(f.root);
  await first.close();
  f.read.mockClear();
  const second = await f.service.open(input);
  expect(f.read).toHaveBeenCalledWith(
    expect.objectContaining({ afterSeq: f.commits.length }),
  );
  expect(await second.snapshot(f.root)).toEqual(expected);
  await expect(first.snapshot(f.root)).rejects.toThrow('closed');
  await first.close(); // A stale handle must not release the new owner.
  expect(await second.snapshot(f.root)).toEqual(expected);
  await second.close();
  f.read.mockRejectedValueOnce(new Error('permission revoked'));
  await expect(f.service.open(input)).rejects.toThrow('permission revoked');
  await f.service.close();
});

it('expires idle readers and bounds active reader admission', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const first = await f.service.open(input);
  await first.close();
  await vi.advanceTimersByTimeAsync(30_001);
  f.read.mockClear();
  const readers = [await f.service.open(input)];
  expect(f.read).toHaveBeenCalledWith(expect.objectContaining({ afterSeq: 0 }));
  for (let i = 1; i < 16; i++) readers.push(await f.service.open(input));
  await expect(f.service.open(input)).rejects.toThrow('capacity');
  await readers[0].close();
  const reused = await f.service.open(input);
  expect(await reused.snapshot(f.root)).toBeDefined();
  await f.service.close();
  vi.useRealTimers();
});

it('passes cancellation into initial replay and discards interrupted replicas', async () => {
  const f = await fixture();
  const controller = new AbortController();
  const original = f.read.getMockImplementation()!;
  f.read.mockImplementationOnce(async (args) => {
    expect(args).toMatchObject({ signal: controller.signal });
    controller.abort();
    return original(args);
  });
  await expect(f.service.open(input, controller.signal)).rejects.toThrow();
  f.read.mockClear();
  const next = await f.service.open(input);
  expect(f.read).toHaveBeenCalledWith(expect.objectContaining({ afterSeq: 0 }));
  await next.close();
  await f.service.close();
});

it('keeps simultaneous readers and different principals isolated', async () => {
  const f = await fixture();
  const first = await f.service.open(input);
  const second = await f.service.open(input);
  await first.close();
  expect(await second.snapshot(f.root)).toBeDefined();
  f.read.mockClear();
  const other = await f.service.open({ ...input, subjectId: 'another-agent' });
  expect(f.read).toHaveBeenCalledWith(expect.objectContaining({ afterSeq: 0 }));
  await second.close();
  await other.close();
  await f.service.close();
});

it.each([
  ['self-parent', [{ id: 1, parent: { conversationId: 1, at: 1 } }]],
  [
    'cycle',
    [
      { id: 1, parent: { conversationId: 100, at: 1 } },
      { id: 100, parent: { conversationId: 1, at: 1 } },
    ],
  ],
  ['missing parent', [{ id: 1, parent: { conversationId: 100, at: 1 } }]],
  ['malformed parent', [{ id: 1, parent: { conversationId: '1', at: 1 } }]],
  ['null parent', [{ id: 1, parent: null }]],
] as const)(
  'rejects %s before native ancestry traversal',
  async (_name, values) => {
    const f = await fixture();
    f.commits[0].writes = values.map((value) => ({
      type: 'conversation',
      value,
    })) as unknown as StorageWrite[];
    // Test open(), not snapshot(): removing the guard fails this assertion rather
    // than hanging the test runner in Pi's synchronous ancestry walk.
    await expect(f.service.open(input)).rejects.toThrow(
      'Invalid conversation ancestry',
    );
    await f.service.close();
    await f.session.close(context);
  },
);

it('reads a valid 1024-conversation chain including forward references in one commit', async () => {
  const f = await fixture();
  const ids = [
    Number(f.root),
    ...Array.from({ length: 1023 }, (_, i) => i + 100),
  ];
  f.commits[0].writes = ids.map((id, index) => ({
    type: 'conversation',
    value: {
      id,
      ...(index < ids.length - 1
        ? { parent: { conversationId: ids[index + 1], at: 1 } }
        : {}),
    },
  })) as StorageWrite[];
  const reader = await f.service.open(input);
  expect((await reader.snapshot(f.root)).messages[0].message.content).toBe(
    'hello',
  );
  await f.service.close();
  await f.session.close(context);
});

it('bounds ancestry depth by rejecting more than 1024 conversations before replay', async () => {
  const f = await fixture();
  f.commits[0].writes = Array.from({ length: 1025 }, (_, index) => ({
    type: 'conversation',
    value: {
      id: index + 1,
      ...(index ? { parent: { conversationId: index, at: 1 } } : {}),
    },
  })) as StorageWrite[];
  await expect(f.service.open(input)).rejects.toThrow('Too many conversations');
  await f.service.close();
  await f.session.close(context);
});

// Charge each tiny fixture commit as 32 MiB to exercise the actual production
// quotas without allocating hundreds of MiB of unrelated message text in CI.
function chargeLargeCommits() {
  return vi.spyOn(Buffer, 'byteLength').mockReturnValue(32 * 1024 * 1024);
}

it('admits exactly 64 MiB and releases the budget after a reader exceeds it', async () => {
  const f = await fixture();
  const size = chargeLargeCommits();
  try {
    const reader = await f.service.open(input); // Two commits, exactly 64 MiB.
    expect(await reader.snapshot(f.root)).toBeDefined();
    f.commits.push({ seq: 3, writes: [] });
    await expect(reader.refresh()).rejects.toThrow('supported size');
    await reader.close();
    f.setCap(2);
    const recovered = await f.service.open(input);
    const peer = await f.service.open(input); // Both fill the 128 MiB pool.
    expect(await recovered.snapshot(f.root)).toEqual(
      await peer.snapshot(f.root),
    );
  } finally {
    size.mockRestore();
    await f.service.close();
    await f.session.close(context);
  }
});

it('bounds overlapping replay at 128 MiB, frees failed admissions and evicts idle readers', async () => {
  const f = await fixture();
  const size = chargeLargeCommits();
  try {
    const results = await Promise.allSettled([
      f.service.open(input),
      f.service.open(input),
      f.service.open(input),
    ]);
    const readers = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    expect(readers.length).toBeGreaterThan(0);
    expect(readers.length).toBeLessThan(3);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ statusCode: 503 });
    }
    // Contenders can fail before another failed admission finishes disposing.
    // Once settled, released bytes must permit filling both 64 MiB slots.
    while (readers.length < 2) readers.push(await f.service.open(input));
    const expected = await readers[1].snapshot(f.root);
    await readers[0].close(); // Now evictable, but still charged to the pool.
    const next = await f.service.open({ ...input, subjectId: 'another-agent' });
    expect(await next.snapshot(f.root)).toEqual(expected);
    expect(await readers[1].snapshot(f.root)).toEqual(expected);
    await expect(f.service.open(input)).rejects.toThrow('capacity');
  } finally {
    size.mockRestore();
    await f.service.close();
    await f.session.close(context);
  }
});

it('reclaims partially replayed bytes after a backing read fails', async () => {
  const f = await fixture();
  const size = chargeLargeCommits();
  try {
    const healthy = await f.service.open(input);
    f.read.mockImplementationOnce(async () => ({
      headSeq: 2,
      count: 2,
      items: (async function* () {
        yield f.commits[0];
        throw new Error('backing read failed');
      })(),
    }));
    await expect(f.service.open(input)).rejects.toThrow('backing read failed');
    const recovered = await f.service.open(input);
    expect(await recovered.snapshot(f.root)).toEqual(
      await healthy.snapshot(f.root),
    );
  } finally {
    size.mockRestore();
    await f.service.close();
    await f.session.close(context);
  }
});
