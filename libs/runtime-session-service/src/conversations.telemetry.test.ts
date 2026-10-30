import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  createSession,
  MemoryStorage,
  type StorageWrite,
} from '@earendil-works/pi-durable';
import { KetoNamespace } from '@moltnet/auth';
import type * as OtelApi from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createConversationService } from './conversations.js';
import { timedRead } from './read-timing.js';
import { createRuntimeStoreService } from './runtime-stores.js';

const spans = vi.hoisted(
  () =>
    [] as {
      name: string;
      attributes: Record<string, unknown>;
      status?: { code: number; message?: string };
      exception?: unknown;
      ended: boolean;
    }[],
);
vi.mock('@opentelemetry/api', async (importOriginal) => ({
  ...(await importOriginal<typeof OtelApi>()),
  trace: {
    getTracer: () => ({
      startActiveSpan: (
        name: string,
        options: { attributes?: Record<string, unknown> },
        fn: (span: unknown) => unknown,
      ) => {
        const recorded: (typeof spans)[number] = {
          name,
          attributes: { ...options.attributes },
          ended: false,
        };
        spans.push(recorded);
        return fn({
          setAttribute: (key: string, value: unknown) => {
            recorded.attributes[key] = value;
          },
          setAttributes: (values: Record<string, unknown>) => {
            Object.assign(recorded.attributes, values);
          },
          setStatus: (status: { code: number; message?: string }) => {
            recorded.status = status;
          },
          recordException: (error: unknown) => {
            recorded.exception = error;
          },
          end: () => {
            recorded.ended = true;
          },
        });
      },
    }),
  },
}));

const context = BACKGROUND_CONTEXT;
const input = {
  subjectId: 'agent',
  subjectType: 'agent' as const,
  subjectNs: KetoNamespace.Agent,
  teamId: 'team',
  taskId: 'task',
  attemptN: 1,
};

/** `perPage` commits per store read; `failAfter` throws after that many. */
async function fixture(
  options: {
    perPage?: number;
    failAfter?: number;
    conversations?: number;
    readDelayMs?: number;
  } = {},
) {
  const commits: { seq: number; writes: StorageWrite[] }[] = [];
  class Writer extends MemoryStorage {
    override async commit(writes: readonly StorageWrite[]) {
      const seq = await super.commit(writes, context);
      commits.push({ seq, writes: [...writes] });
      return seq;
    }
  }
  const session = createSession(new Writer());
  const add = () =>
    session.commit(
      (tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }),
      context,
    );
  for (let i = 0; i < (options.conversations ?? 2); i++) await add();
  let served = 0;
  const service = createConversationService({
    stores: {
      findAttempt: async () => ({ storeId: 'store' }),
      read: async ({ afterSeq }: { afterSeq: number }) => ({
        items: (async function* () {
          let yielded = 0;
          for (const commit of commits) {
            if (commit.seq <= afterSeq) continue;
            if (yielded++ === (options.perPage ?? Infinity)) return;
            if (served++ === options.failAfter)
              throw new Error('object store unavailable');
            if (options.readDelayMs) await sleep(options.readDelayMs);
            yield commit;
          }
        })(),
      }),
    },
    repository: {
      attemptBounds: async () => ({ firstSeq: 1, lastSeq: commits.length }),
      get: async () => null,
    },
    tasks: { findAttempt: async () => ({ status: 'completed' }) },
  } as unknown as Parameters<typeof createConversationService>[0]);
  return { service, session, add };
}

describe('conversation refresh telemetry', () => {
  beforeEach(() => {
    spans.length = 0;
  });

  it('records cold and incremental replay sizes on the refresh span', async () => {
    const f = await fixture();
    const reader = await f.service.open(input);
    await f.add();
    await reader.refresh();
    await reader.close();
    await f.service.close();
    await f.session.close(context);

    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({
      name: 'moltnet.conversation.refresh',
      ended: true,
      status: { code: SpanStatusCode.OK },
      attributes: {
        'moltnet.conversation.cold': true,
        'moltnet.conversation.commits_replayed': 2,
        'moltnet.conversation.pages': 1,
        'moltnet.conversation.from_seq': 0,
        'moltnet.conversation.target_seq': 2,
        'moltnet.conversation.first_seq': 1,
        'moltnet.conversation.read_wait_ms': expect.any(Number) as unknown,
        'moltnet.conversation.apply_ms': expect.any(Number) as unknown,
      },
    });
    expect(
      spans[0].attributes['moltnet.conversation.replay_bytes'],
    ).toBeGreaterThan(0);
    expect(spans[1].attributes).toMatchObject({
      'moltnet.conversation.cold': false,
      'moltnet.conversation.commits_replayed': 1,
      'moltnet.conversation.from_seq': 2,
      'moltnet.conversation.target_seq': 3,
      'moltnet.conversation.pages': 1,
    });
  });

  it('attributes slow object reads to read_wait_ms, not apply_ms', async () => {
    const f = await fixture({ conversations: 3, readDelayMs: 20 });
    const reader = await f.service.open(input);
    await reader.close();
    await f.service.close();
    await f.session.close(context);

    const attributes = spans[0].attributes as Record<string, number>;
    expect(
      attributes['moltnet.conversation.read_wait_ms'],
    ).toBeGreaterThanOrEqual(55);
    expect(attributes['moltnet.conversation.apply_ms']).toBeLessThan(
      attributes['moltnet.conversation.read_wait_ms'],
    );
    expect(spans[0].attributes).toMatchObject({
      'moltnet.task.id': 'task',
      'moltnet.task.attempt_n': 1,
      'moltnet.conversation.store_id': 'store',
    });
  });

  it('counts every page read and none when nothing is new', async () => {
    const f = await fixture({ perPage: 2, conversations: 5 });
    const reader = await f.service.open(input);
    await reader.refresh();
    await reader.close();
    await f.service.close();
    await f.session.close(context);

    expect(spans[0].attributes).toMatchObject({
      'moltnet.conversation.commits_replayed': 5,
      'moltnet.conversation.pages': 3,
    });
    expect(spans[1].attributes).toMatchObject({
      'moltnet.conversation.commits_replayed': 0,
      'moltnet.conversation.pages': 0,
    });
  });

  it('records the failure and how far replay got', async () => {
    const f = await fixture({ conversations: 4, failAfter: 2 });
    await expect(f.service.open(input)).rejects.toThrow(
      'object store unavailable',
    );
    await f.service.close();
    await f.session.close(context);

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      ended: true,
      status: {
        code: SpanStatusCode.ERROR,
        message: 'object store unavailable',
      },
      exception: expect.objectContaining({
        message: 'object store unavailable',
      }) as unknown,
      attributes: {
        'moltnet.conversation.commits_replayed': 2,
        'moltnet.conversation.pages': 1,
        // A failed cold read shows how far it got against its target.
        'moltnet.conversation.target_seq': 4,
      },
    });
  });

  it('does not mark a caller abort as a server error', async () => {
    const f = await fixture();
    const controller = new AbortController();
    const reader = await f.service.open(input);
    controller.abort();
    await expect(reader.refresh(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await reader.close();
    await f.service.close();
    await f.session.close(context);

    expect(spans[1].status).toBeUndefined();
    expect(spans[1].ended).toBe(true);
    expect(spans[1].attributes['moltnet.conversation.aborted_by']).toBe(
      'caller',
    );
  });

  it('records a server deadline as an error', async () => {
    const f = await fixture();
    const controller = new AbortController();
    const reader = await f.service.open(input);
    controller.abort(new DOMException('deadline', 'TimeoutError'));
    await expect(reader.refresh(controller.signal)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await reader.close();
    await f.service.close();
    await f.session.close(context);

    expect(spans[1].status).toMatchObject({ code: SpanStatusCode.ERROR });
    expect(spans[1].exception).toBeDefined();
    expect(spans[1].attributes['moltnet.conversation.aborted_by']).toBe(
      'deadline',
    );
  });
});

it('separates database, permission, full-body download and decode spans', async () => {
  const bytes = Buffer.from(
    JSON.stringify({ format: 'pi-durable.v1', writes: [] }),
  );
  spans.length = 0;
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const bodyGate = deferred();
  const bodyStarted = deferred();
  const service = downloadFixture(
    bytes,
    Readable.from(
      (async function* () {
        bodyStarted.resolve();
        await bodyGate.promise;
        yield bytes;
      })(),
    ),
  );
  const page = await service.read({ ...input, storeId: 'store' });
  const consumed = (async () => {
    for await (const commit of page.items) expect(commit.seq).toBe(1);
  })();
  await bodyStarted.promise;
  try {
    expect(
      spans.find((s) => s.name === 'moltnet.runtime.read.object.download')
        ?.ended,
    ).toBe(false);
    expect(
      spans.some((s) => s.name === 'moltnet.runtime.read.object.decode'),
    ).toBe(false);
    for (const phase of [
      'database.store',
      'database.commits',
      'database.attempts',
      'database.contributors',
      'authorization.team',
      'authorization.tasks',
    ]) {
      expect(
        spans.find((s) => s.name === `moltnet.runtime.read.${phase}`)?.ended,
      ).toBe(true);
    }
  } finally {
    bodyGate.resolve();
    await consumed;
  }
  expect(
    spans.find((s) => s.name === 'moltnet.runtime.read.object.download')?.ended,
  ).toBe(true);
  expect(
    spans.find((s) => s.name === 'moltnet.runtime.read.object.decode')?.ended,
  ).toBe(true);
});

function downloadFixture(bytes: Buffer, body: Readable) {
  return createRuntimeStoreService({
    repository: {
      get: async () => ({ id: 'store', headSeq: 1 }),
      listCommits: async () => [
        {
          seq: 1,
          taskId: 'task',
          commitId: 'commit',
          objectKey: 'key',
          sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ],
      listCommitTaskIds: async () => ['task'],
      listAttempts: async () => [{ taskId: 'task' }],
    },
    permissionChecker: {
      canAccessTeam: async () => true,
      canViewTasks: async () => new Map([['task', true]]),
    },
    storage: {
      getObject: async () => ({ body }),
    },
    maxBytes: 1024,
  } as unknown as Parameters<typeof createRuntimeStoreService>[0]);
}

it.each(['caller', 'deadline', 'storage-race'] as const)(
  'classifies an interrupted full-body download: %s',
  async (kind) => {
    spans.length = 0;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const body = new Readable({
      read() {
        markStarted();
      },
    });
    const service = downloadFixture(Buffer.from('pending'), body);
    const controller = new AbortController();
    const page = await service.read({
      ...input,
      storeId: 'store',
      signal: controller.signal,
    });
    const consumed = (async () => {
      for await (const _commit of page.items) {
        /* consume */
      }
    })();
    const failed = expect(consumed).rejects.toBeDefined();
    await started;
    if (kind === 'storage-race') {
      body.destroy(new Error('storage failed'));
      controller.abort();
    } else {
      controller.abort(
        kind === 'deadline'
          ? new DOMException('deadline', 'TimeoutError')
          : undefined,
      );
    }
    await failed;
    const span = spans.find(
      (s) => s.name === 'moltnet.runtime.read.object.download',
    );
    expect(span?.ended).toBe(true);
    if (kind === 'caller') {
      expect(span?.status).toBeUndefined();
      expect(span?.exception).toBeUndefined();
      expect(span?.attributes['moltnet.runtime.read.aborted_by']).toBe(
        'caller',
      );
    } else {
      expect(span?.status).toEqual({ code: SpanStatusCode.ERROR });
      expect(span?.exception).toBeDefined();
    }
    expect(
      spans.some((s) => s.name === 'moltnet.runtime.read.object.decode'),
    ).toBe(false);
  },
);

it('recognizes client AbortErrors that omit the signal reason', async () => {
  spans.length = 0;
  const controller = new AbortController();
  const error = Object.assign(new Error('request aborted'), {
    name: 'AbortError',
  });
  await expect(
    timedRead(
      'object.download',
      () => {
        controller.abort();
        return Promise.reject(error);
      },
      controller.signal,
    ),
  ).rejects.toBe(error);
  expect(spans[0]).toMatchObject({
    ended: true,
    attributes: { 'moltnet.runtime.read.aborted_by': 'caller' },
  });
  expect(spans[0].status).toBeUndefined();
  expect(spans[0].exception).toBeUndefined();
});
