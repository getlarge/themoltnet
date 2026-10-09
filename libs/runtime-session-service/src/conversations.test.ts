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
import { describe, expect, it, vi } from 'vitest';

import { createConversationService } from './conversations.js';

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
