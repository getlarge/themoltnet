import { Readable } from 'node:stream';

import { KetoNamespace } from '@moltnet/auth';
import { describe, expect, it, vi } from 'vitest';

import { READ_EXPANSION } from './read-ahead.js';
import { createRuntimeStoreService } from './runtime-stores.js';

type Dependencies = Parameters<typeof createRuntimeStoreService>[0];
const authority = {
  subjectId: 'agent',
  subjectNs: KetoNamespace.Agent,
  subjectType: 'agent' as const,
  teamId: 'team',
  taskId: 'task',
  attemptN: 1,
  leaseId: 'lease',
  executorFingerprint: 'fingerprint',
};
function setup(
  options: { readConcurrency?: number; readAheadBytes?: number } = {},
) {
  let now = Date.now();
  const objects = new Map<string, Buffer>();
  const row = {
    id: 'store',
    teamId: 'team',
    format: 'pi-durable.v1',
    headSeq: 0,
    nextId: 2,
    writerToken: null,
    writerExpiresAt: null,
  } as Record<string, unknown>;
  const commits: Array<Record<string, unknown>> = [];
  const binding = {
    storeId: 'store',
    teamId: 'team',
    taskId: 'task',
    attemptN: 1,
  };
  const repository = {
    conversationHead: vi.fn(async () => Number(row.headSeq) - 1),
    conversationRecord: vi.fn(async () => undefined),
    saveConversationRecords: vi.fn(),
    lockAuthority: vi.fn(async () => ({
      task: { input: {}, claimExpiresAt: new Date(now + 300_000) },
      attempt: {},
    })),
    findAttempt: vi.fn(async () => binding),
    listAttempts: vi.fn(async () => [binding]),
    listCommitTaskIds: vi.fn(async () => [
      ...new Set(commits.map((commit) => String(commit.taskId))),
    ]),
    bindAttempt: vi.fn(),
    create: vi.fn(async () => ({ ...row })),
    fork: vi.fn(async () => ({ ...row, id: 'fork-store' })),
    lock: vi.fn(async (team: string) => (team === 'team' ? { ...row } : null)),
    get: vi.fn(async (_team: string, storeId: string) => ({
      ...row,
      id: storeId,
    })),
    update: vi.fn(async (_id: string, patch: object) => {
      Object.assign(row, patch);
    }),
    findCommit: vi.fn(async (_store: string, id: string) =>
      commits.find((c) => c.commitId === id),
    ),
    append: vi.fn(async (commit: Record<string, unknown>) => {
      commits.push(commit);
      row.headSeq = commit.seq;
    }),
    listCommits: vi.fn(
      async (_store: string, after: number, limit: number, head: number) =>
        commits
          .filter((c) => Number(c.seq) > after && Number(c.seq) <= head)
          .slice(0, limit),
    ),
  };
  const storage = {
    putObject: vi.fn(async (object: { key: string; body: Readable }) => {
      const bytes: Buffer[] = [];
      for await (const chunk of object.body)
        bytes.push(Buffer.from(chunk as Uint8Array));
      objects.set(object.key, Buffer.concat(bytes));
    }),
    getObject: vi.fn(async (key: string, _signal?: AbortSignal) => ({
      body: Readable.from([objects.get(key)!]),
    })),
    deleteObject: vi.fn(),
    deleteObjects: vi.fn(),
  };
  const permissionChecker = {
    canAccessTeam: vi.fn(async () => true),
    canViewTask: vi.fn(async () => true),
    canViewTasks: vi.fn(
      async (taskIds: string[]) =>
        new Map(taskIds.map((taskId) => [taskId, true])),
    ),
  };
  const deps = {
    repository,
    storage,
    permissionChecker,
    maxBytes: 100_000,
    ...options,
    now: () => now,
    transactionRunner: {
      runInTransaction: async (fn: () => Promise<unknown>) => fn(),
    },
  } as unknown as Dependencies;
  return {
    service: createRuntimeStoreService(deps),
    repository,
    storage,
    permissionChecker,
    row,
    commits,
    objects,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const writes = [
  {
    type: 'entry',
    value: {
      id: 10,
      conversationId: 1,
      kind: 'pi.assistant',
      model: [{ content: 'large private content' }],
    },
  },
];

describe('conversation projection backfill', () => {
  it('rejects a sequence gap before publishing projection records', async () => {
    const f = setup();
    f.row.headSeq = 3;
    const handle = await f.service.open(authority);
    await f.service.append({
      ...authority,
      ...handle,
      commitId: 'after-gap',
      expectedSeq: 3,
      writes,
    });
    f.repository.conversationHead.mockResolvedValue(2);
    f.repository.saveConversationRecords.mockClear();

    await expect(
      f.service.ensureConversationProjection({
        ...authority,
        storeId: handle.storeId,
        throughSeq: 4,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Conversation projection gap',
    });
    expect(f.repository.saveConversationRecords).not.toHaveBeenCalled();
    expect(f.repository.listCommits).toHaveBeenCalledTimes(1);
  });

  it('fails without retrying when backfill does not advance its head', async () => {
    const f = setup();
    const handle = await f.service.open(authority);
    await f.service.append({
      ...authority,
      ...handle,
      commitId: 'no-progress',
      expectedSeq: 0,
      writes,
    });
    // The write mock deliberately never advances the projection head.
    f.repository.conversationHead.mockResolvedValue(0);
    f.repository.saveConversationRecords.mockClear();

    await expect(
      f.service.ensureConversationProjection({
        ...authority,
        storeId: handle.storeId,
        throughSeq: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Incomplete conversation history',
    });
    expect(f.repository.saveConversationRecords).toHaveBeenCalledTimes(1);
    expect(f.repository.saveConversationRecords).toHaveBeenCalledWith(
      handle.storeId,
      1,
      expect.any(Array),
    );
    expect(f.repository.listCommits).toHaveBeenCalledTimes(1);
  });
});

describe('runtime store publication', () => {
  it('forks the parent commit head into an independent store', async () => {
    const f = setup();
    f.repository.lockAuthority.mockResolvedValueOnce({
      task: {
        input: {
          continueFrom: { taskId: 'parent', attemptN: 1, mode: 'fork' },
        },
        claimExpiresAt: new Date(Date.now() + 300_000),
      },
      attempt: {},
    });
    f.repository.findAttempt
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        teamId: 'team',
        taskId: 'parent',
        attemptN: 1,
        storeId: 'store',
      });
    const handle = await f.service.open(authority);
    expect(handle.storeId).toBe('fork-store');
    expect(f.repository.fork).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'store' }),
    );
    expect(f.repository.bindAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'fork-store' }),
    );
  });
  it('denies a fork reader who cannot view copied parent commits', async () => {
    const f = setup();
    f.repository.listAttempts.mockResolvedValue([
      { teamId: 'team', taskId: 'task', attemptN: 1, storeId: 'fork-store' },
    ]);
    f.repository.listCommits.mockResolvedValueOnce([{ taskId: 'parent' }]);
    f.permissionChecker.canViewTasks.mockResolvedValue(
      new Map([
        ['task', true],
        ['parent', false],
      ]),
    );

    await expect(
      f.service.read({ ...authority, storeId: 'fork-store' }),
    ).rejects.toThrow();
    expect(f.permissionChecker.canViewTasks).toHaveBeenCalledWith(
      ['task', 'parent'],
      authority.subjectId,
      authority.subjectNs,
    );
    expect(f.storage.getObject).not.toHaveBeenCalled();
  });
  it('refuses to fork a source with hidden ancestor commits', async () => {
    const f = setup();
    f.repository.lockAuthority.mockResolvedValueOnce({
      task: {
        input: {
          continueFrom: { taskId: 'parent', attemptN: 1, mode: 'fork' },
        },
        claimExpiresAt: new Date(Date.now() + 300_000),
      },
      attempt: {},
    });
    f.repository.findAttempt.mockResolvedValueOnce(null as never);
    f.repository.listCommitTaskIds.mockResolvedValue(['ancestor']);
    f.permissionChecker.canViewTasks.mockResolvedValue(
      new Map([
        ['task', true],
        ['ancestor', false],
      ]),
    );

    await expect(f.service.open(authority)).rejects.toThrow();
    expect(f.repository.fork).not.toHaveBeenCalled();
  });
  it('returns one receipt without task-message projection for repeated acknowledgment retries', async () => {
    const f = setup();
    const handle = await f.service.open(authority);
    const commit = {
      ...authority,
      ...handle,
      commitId: 'commit',
      expectedSeq: 0,
      writes,
    };
    expect(await f.service.append(commit)).toEqual({ seq: 1 });
    expect(await f.service.append(commit)).toEqual({ seq: 1 });
    expect(f.commits).toHaveLength(1);
    expect(f.storage.putObject).toHaveBeenCalledTimes(1);
    expect(f.row.nextId).toBe(11);
    const page = await f.service.read({
      ...authority,
      storeId: handle.storeId,
    });
    expect((await collect(page.items))[0].writes).toEqual(writes);
    await expect(f.service.append({ ...commit, writes: [] })).rejects.toThrow(
      'Commit ID',
    );
    expect(f.storage.putObject).toHaveBeenCalledTimes(1);
    // Even a published receipt must not bypass writer fencing.
    f.advance(30_001);
    await expect(f.service.append(commit)).rejects.toThrow('stale');
    expect(f.storage.putObject).toHaveBeenCalledTimes(1);
  });
  it('returns a receipt published during upload without publishing it again', async () => {
    const f = setup();
    const handle = await f.service.open(authority);
    const input = {
      ...authority,
      ...handle,
      commitId: 'racing',
      expectedSeq: 0,
      writes,
    };
    const upload = f.storage.putObject.getMockImplementation()!;
    f.storage.putObject.mockImplementation(async (object) => {
      await upload(object);
      // Simulate another identical request publishing before this upload returns.
      const sha256 = object.key.split('/').at(-1)!.replace('.json', '');
      f.commits.push({
        seq: 1,
        commitId: input.commitId,
        sha256,
        taskId: input.taskId,
        attemptN: input.attemptN,
      });
      f.row.headSeq = 1;
    });
    await expect(f.service.append(input)).resolves.toEqual({ seq: 1 });
    expect(f.repository.append).not.toHaveBeenCalled();
  });

  it('rejects a stale expected head before uploading a new object', async () => {
    const f = setup();
    const handle = await f.service.open(authority);
    await expect(
      f.service.append({
        ...authority,
        ...handle,
        commitId: 'bad-head',
        expectedSeq: 1,
        writes,
      }),
    ).rejects.toThrow('head changed');
    expect(f.storage.putObject).not.toHaveBeenCalled();
  });

  it('fences a stale writer after expiry and reacquisition', async () => {
    const f = setup();
    const first = await f.service.open(authority);
    await expect(f.service.open(authority)).rejects.toThrow('active writer');
    f.advance(30_001);
    const second = await f.service.open(authority);
    expect(second.writerToken).not.toBe(first.writerToken);
    await expect(f.service.mintId({ ...authority, ...first })).rejects.toThrow(
      'stale',
    );
    expect(await f.service.mintId({ ...authority, ...second })).toBe(2);
    await expect(f.service.renew({ ...authority, ...first })).rejects.toThrow(
      'stale',
    );
  });
  it('rechecks authority after upload and keeps an unreferenced blob for safe later collection', async () => {
    const f = setup();
    const handle = await f.service.open(authority);
    const original = f.storage.putObject.getMockImplementation()!;
    f.storage.putObject.mockImplementation(async (object) => {
      await original(object);
      f.repository.lockAuthority.mockResolvedValueOnce(null as never);
    });
    await expect(
      f.service.append({
        ...authority,
        ...handle,
        commitId: 'commit',
        expectedSeq: 0,
        writes,
      }),
    ).rejects.toThrow('authority');
    expect(f.commits).toHaveLength(0);
    expect(f.objects.size).toBe(1);
    expect(f.storage.deleteObject).not.toHaveBeenCalled();
  });
  it('denies cross-team writes and readers without access to every bound task', async () => {
    const f = setup();
    const handle = await f.service.open(authority);
    await expect(
      f.service.mintId({ ...authority, ...handle, teamId: 'other' }),
    ).rejects.toThrow();
    f.repository.listAttempts.mockResolvedValueOnce([
      { teamId: 'team', taskId: 'task', attemptN: 1, storeId: 'store' },
      { teamId: 'team', taskId: 'ancestor', attemptN: 1, storeId: 'store' },
    ]);
    f.permissionChecker.canViewTasks.mockResolvedValue(
      new Map([
        ['task', true],
        ['ancestor', false],
      ]),
    );
    await expect(
      f.service.read({ ...authority, storeId: handle.storeId }),
    ).rejects.toThrow();
    expect(f.permissionChecker.canViewTasks).toHaveBeenCalledWith(
      ['task', 'ancestor'],
      authority.subjectId,
      authority.subjectNs,
    );
    expect(f.storage.getObject).not.toHaveBeenCalled();
  });
  it('detects corrupt object payloads and reads only through the captured head', async () => {
    const f = setup();
    const handle = await f.service.open(authority);
    await f.service.append({
      ...authority,
      ...handle,
      commitId: 'commit',
      expectedSeq: 0,
      writes,
    });
    for (const key of f.objects.keys())
      f.objects.set(key, Buffer.from('corrupt'));
    const page = await f.service.read({
      ...authority,
      storeId: handle.storeId,
    });
    expect(f.storage.getObject).not.toHaveBeenCalled();
    await expect(collect(page.items)).rejects.toThrow('checksum');
    expect(f.repository.listCommits).toHaveBeenCalledWith('store', 0, 50, 1);
  });
  it(
    'stops prefetching on early return and releases every in-flight object',
    { timeout: 2000 },
    async () => {
      const f = setup({ readConcurrency: 2 });
      await seed(f, 5);
      const page = await f.service.read({ ...authority, storeId: 'store' });
      expect(page.count).toBe(5);
      expect(f.storage.getObject).not.toHaveBeenCalled();
      for await (const commit of page.items) {
        expect(commit.seq).toBe(1);
        expect(commit.writes).toEqual(writes);
        break;
      }
      // The window is refilled only when the consumer asks for more.
      expect(f.storage.getObject).toHaveBeenCalledTimes(2);
      for (const [, signal] of f.storage.getObject.mock.calls)
        expect((signal as AbortSignal).aborted).toBe(true);
    },
  );
});

async function seed(f: ReturnType<typeof setup>, count: number) {
  const handle = await f.service.open(authority);
  for (let i = 0; i < count; i++)
    await f.service.append({
      ...authority,
      ...handle,
      commitId: `commit-${i}`,
      expectedSeq: i,
      writes: [{ ...writes[0], value: { ...writes[0].value, id: 10 + i } }],
    });
  // Keys in sequence order, for per-object storage behaviour.
  return [...f.objects.keys()];
}

/**
 * Storage whose object bodies stay stalled until the test releases them, so an
 * in-flight fetch holds a real open stream the reader must destroy on abort.
 */
function gatedStorage(f: ReturnType<typeof setup>) {
  const gates = new Map<string, (() => void)[]>();
  const bodies: Readable[] = [];
  let inflight = 0;
  let maxInflight = 0;
  f.storage.getObject.mockImplementation(async (key: string) => {
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    const body = new Readable({ read() {} });
    body.once('close', () => inflight--);
    gates.set(key, [
      ...(gates.get(key) ?? []),
      () => {
        body.push(f.objects.get(key)!);
        body.push(null);
      },
    ]);
    bodies.push(body);
    return { body };
  });
  return {
    release: (key: string) => {
      for (const open of gates.get(key) ?? []) open();
    },
    started: (key: string) => gates.has(key),
    bodies,
    get maxInflight() {
      return maxInflight;
    },
  };
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

it('cancels a stalled object body without reading subsequent commits', async () => {
  const f = setup();
  const handle = await f.service.open(authority);
  await f.service.append({
    ...authority,
    ...handle,
    commitId: 'cancelled-read',
    expectedSeq: 0,
    writes,
  });
  const body = new Readable({ read() {} });
  f.storage.getObject.mockResolvedValue({ body });
  const controller = new AbortController();
  const page = await f.service.read({
    ...authority,
    storeId: 'store',
    signal: controller.signal,
  });
  const pending = page.items.next();
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  await vi.waitFor(() => expect(f.storage.getObject).toHaveBeenCalled());
  controller.abort();
  await rejected;
  expect(body.destroyed).toBe(true);
  expect(f.storage.getObject).toHaveBeenCalledTimes(1);
});

it('caches contributors by captured head but rechecks permissions and bindings on every read', async () => {
  const f = setup();
  f.row.headSeq = 10;
  f.repository.listCommitTaskIds.mockResolvedValue(['ancestor']);
  const input = { ...authority, storeId: 'store', afterSeq: 10 };
  await f.service.read(input);
  f.permissionChecker.canViewTasks.mockResolvedValue(
    new Map([
      ['task', true],
      ['ancestor', false],
    ]),
  );
  await expect(f.service.read(input)).rejects.toMatchObject({
    statusCode: 404,
  });
  expect(f.repository.listCommitTaskIds).toHaveBeenCalledTimes(1);
  expect(f.repository.listAttempts).toHaveBeenCalledTimes(2);
  expect(f.permissionChecker.canViewTasks).toHaveBeenCalledTimes(2);
  f.permissionChecker.canViewTasks.mockImplementation(
    async (ids) => new Map(ids.map((id) => [id, true])),
  );
  f.row.headSeq = 11;
  f.repository.listCommitTaskIds.mockResolvedValue(['ancestor', 'new-task']);
  await f.service.read(input);
  expect(f.repository.listCommitTaskIds).toHaveBeenCalledTimes(2);
  expect(f.permissionChecker.canViewTasks).toHaveBeenLastCalledWith(
    ['task', 'ancestor', 'new-task'],
    authority.subjectId,
    authority.subjectNs,
  );
});

it('does not label contributor discovery with a revision published during the query', async () => {
  const f = setup();
  f.row.headSeq = 1;
  f.repository.listCommitTaskIds.mockImplementationOnce(async () => {
    f.row.headSeq = 2;
    return ['task'];
  });
  await f.service.read({ ...authority, storeId: 'store' });
  f.repository.listCommitTaskIds.mockResolvedValue(['task', 'new-task']);
  await f.service.read({ ...authority, storeId: 'store' });
  expect(f.repository.listCommitTaskIds).toHaveBeenCalledTimes(2);
  expect(f.permissionChecker.canViewTasks).toHaveBeenLastCalledWith(
    ['task', 'new-task'],
    authority.subjectId,
    authority.subjectNs,
  );
});

it('bounds contributor cache entries across stores', async () => {
  const f = setup();
  for (let i = 0; i < 129; i++)
    await f.service.read({ ...authority, storeId: `store-${i}` });
  f.repository.listCommitTaskIds.mockClear();
  await f.service.read({ ...authority, storeId: 'store-128' });
  expect(f.repository.listCommitTaskIds).not.toHaveBeenCalled();
  await f.service.read({ ...authority, storeId: 'store-0' });
  expect(f.repository.listCommitTaskIds).toHaveBeenCalledOnce();
});

it('does not retain oversized contributor lists', async () => {
  const f = setup();
  f.repository.listCommitTaskIds.mockResolvedValue(
    Array.from({ length: 1025 }, (_, i) => `task-${i}`),
  );
  await f.service.read({ ...authority, storeId: 'store' });
  await f.service.read({ ...authority, storeId: 'store' });
  expect(f.repository.listCommitTaskIds).toHaveBeenCalledTimes(2);
});

describe('concurrent ordered object reads', () => {
  it('yields commits in sequence order when objects complete out of order', async () => {
    const f = setup({ readConcurrency: 4 });
    const keys = await seed(f, 4);
    const gate = gatedStorage(f);
    const page = await f.service.read({ ...authority, storeId: 'store' });
    const result = collect(page.items);
    await vi.waitFor(() => expect(gate.started(keys[3])).toBe(true));
    for (const key of [...keys].reverse()) gate.release(key);
    const commits = await result;
    expect(commits.map((commit) => commit.seq)).toEqual([1, 2, 3, 4]);
    expect(commits.map((commit) => commit.writes[0].value)).toEqual(
      [10, 11, 12, 13].map((id): unknown => expect.objectContaining({ id })),
    );
  });

  it('never exceeds the configured number of in-flight object fetches', async () => {
    const f = setup({ readConcurrency: 3 });
    const keys = await seed(f, 10);
    const gate = gatedStorage(f);
    const page = await f.service.read({ ...authority, storeId: 'store' });
    const result = collect(page.items);
    for (const key of keys) {
      await vi.waitFor(() => expect(gate.started(key)).toBe(true));
      gate.release(key);
    }
    expect((await result).map((commit) => commit.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(gate.maxInflight).toBe(3);
    expect(f.storage.getObject).toHaveBeenCalledTimes(10);
  });

  it(
    'cancels every in-flight fetch when the caller aborts mid-page',
    { timeout: 2000 },
    async () => {
      const f = setup({ readConcurrency: 3 });
      const keys = await seed(f, 6);
      const gate = gatedStorage(f);
      const controller = new AbortController();
      const page = await f.service.read({
        ...authority,
        storeId: 'store',
        signal: controller.signal,
      });
      const result = collect(page.items);
      const rejected = expect(result).rejects.toMatchObject({
        name: 'AbortError',
      });
      await vi.waitFor(() => expect(gate.started(keys[2])).toBe(true));
      gate.release(keys[0]);
      await vi.waitFor(() => expect(gate.started(keys[3])).toBe(true));
      controller.abort();
      await rejected;
      expect(f.storage.getObject).toHaveBeenCalledTimes(4);
      for (const [, signal] of f.storage.getObject.mock.calls)
        expect((signal as AbortSignal).aborted).toBe(true);
      // keys[0] completed; keys[1..3] were stalled mid-transfer at the abort.
      expect(gate.bodies).toHaveLength(4);
      expect(gate.bodies.every((body) => body.destroyed)).toBe(true);
    },
  );

  it(
    'reports a failed later object instead of the aborts it causes',
    { timeout: 2000 },
    async () => {
      const f = setup({ readConcurrency: 3 });
      const keys = await seed(f, 5);
      gatedStorage(f);
      const missing = new Error('Runtime session object is missing');
      const gated = f.storage.getObject.getMockImplementation()!;
      f.storage.getObject.mockImplementation(async (key: string, signal) => {
        if (key === keys[2]) throw missing;
        return gated(key, signal);
      });
      const page = await f.service.read({ ...authority, storeId: 'store' });
      // The head object is still pending; the failure must not wait for it.
      await expect(collect(page.items)).rejects.toBe(missing);
      for (const [, signal] of f.storage.getObject.mock.calls)
        expect((signal as AbortSignal).aborted).toBe(true);
      expect(f.storage.getObject).toHaveBeenCalledTimes(3);
    },
  );

  it('yields the verified prefix, then rejects a corrupt object', async () => {
    const f = setup({ readConcurrency: 4 });
    const keys = await seed(f, 4);
    f.objects.set(keys[2], Buffer.from('corrupt'));
    const page = await f.service.read({ ...authority, storeId: 'store' });
    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const commit of page.items) seen.push(commit.seq);
      })(),
    ).rejects.toThrow('Runtime commit 3 checksum mismatch');
    expect(seen).toEqual([1, 2]);
  });

  it('fails fast with the real error when a later corrupt object completes first', async () => {
    const f = setup({ readConcurrency: 4 });
    const keys = await seed(f, 4);
    f.objects.set(keys[2], Buffer.from('corrupt'));
    const gate = gatedStorage(f);
    const page = await f.service.read({ ...authority, storeId: 'store' });
    const seen: number[] = [];
    const result = (async () => {
      for await (const commit of page.items) seen.push(commit.seq);
    })();
    await vi.waitFor(() => expect(gate.started(keys[3])).toBe(true));
    gate.release(keys[2]);
    // Earlier objects never complete; the checksum failure must not wait for
    // them, and must not be replaced by the aborts it causes.
    await expect(result).rejects.toThrow('Runtime commit 3 checksum mismatch');
    expect(seen).toEqual([]);
    expect(gate.bodies.every((body) => body.destroyed)).toBe(true);
  });

  it('destroys an oversized object streamed in several chunks', async () => {
    const f = setup({ readConcurrency: 4 });
    await seed(f, 2);
    const oversized = new Readable({ read() {} });
    for (let i = 0; i < 4; i++) oversized.push(Buffer.alloc(30_000));
    f.storage.getObject.mockResolvedValueOnce({ body: oversized });
    await expect(
      collect((await f.service.read({ ...authority, storeId: 'store' })).items),
    ).rejects.toThrow('Stored runtime commit 1 exceeds size limit');
    expect(oversized.destroyed).toBe(true);
  });

  it('reads one object at a time, without read-ahead, by default', async () => {
    const f = setup();
    const keys = await seed(f, 3);
    const gate = gatedStorage(f);
    const page = await f.service.read({ ...authority, storeId: 'store' });
    const result = collect(page.items);
    for (const key of keys) {
      await vi.waitFor(() => expect(gate.started(key)).toBe(true));
      gate.release(key);
    }
    expect(await result).toHaveLength(3);
    expect(gate.maxInflight).toBe(1);
  });

  it('does not fetch ahead while the consumer holds a commit at concurrency 1', async () => {
    const f = setup();
    await seed(f, 3);
    const page = await f.service.read({ ...authority, storeId: 'store' });
    expect((await page.items.next()).value).toMatchObject({ seq: 1 });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(f.storage.getObject).toHaveBeenCalledTimes(1);
    await page.items.return(undefined);
  });

  it('throws when the caller aborts between authorization and iteration', async () => {
    const f = setup({ readConcurrency: 4 });
    await seed(f, 3);
    const controller = new AbortController();
    const page = await f.service.read({
      ...authority,
      storeId: 'store',
      signal: controller.signal,
    });
    controller.abort();
    await expect(collect(page.items)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(f.storage.getObject).not.toHaveBeenCalled();
  });

  it('throws when the caller aborts after the last pending fetch resolved', async () => {
    const f = setup();
    await seed(f, 2);
    const controller = new AbortController();
    const page = await f.service.read({
      ...authority,
      storeId: 'store',
      signal: controller.signal,
    });
    await page.items.next();
    controller.abort();
    await expect(page.items.next()).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it.each([undefined, 0, ''])(
    'rethrows a falsy rejection unchanged: %j',
    async (thrown) => {
      const f = setup({ readConcurrency: 2 });
      await seed(f, 2);
      f.storage.getObject.mockImplementationOnce(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject(thrown),
      );
      const page = await f.service.read({ ...authority, storeId: 'store' });
      await expect(collect(page.items)).rejects.toBe(thrown);
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects an invalid read concurrency: %s',
    (readConcurrency) => {
      expect(() => setup({ readConcurrency })).toThrow(RangeError);
    },
  );

  it('does not fetch objects before authorization succeeds', async () => {
    const f = setup({ readConcurrency: 4 });
    await seed(f, 3);
    f.permissionChecker.canViewTasks.mockResolvedValueOnce(
      new Map([['task', false]]),
    );
    await expect(
      f.service.read({ ...authority, storeId: 'store' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(f.storage.getObject).not.toHaveBeenCalled();
  });
});

describe('shared read-ahead byte budget', () => {
  /** Reads a whole page while the gate releases objects as they start. */
  async function drain(
    f: ReturnType<typeof setup>,
    gate: ReturnType<typeof gatedStorage>,
    keys: string[],
  ) {
    const page = await f.service.read({ ...authority, storeId: 'store' });
    const result = collect(page.items);
    for (const key of keys) {
      await vi.waitFor(() => expect(gate.started(key)).toBe(true));
      gate.release(key);
    }
    return result;
  }
  const readAheadCost = (f: ReturnType<typeof setup>) =>
    Number(f.commits[0].sizeBytes) * READ_EXPANSION;
  // Room for exactly two read-aheads; +1 absorbs commits a byte longer.
  const twoReadAheads = (cost: number) => cost * 2 + 1;

  it('bounds read-ahead across concurrent reads by bytes, not commit count', async () => {
    const probe = setup();
    await seed(probe, 1);
    const cost = readAheadCost(probe);
    const f = setup({
      readConcurrency: 8,
      readAheadBytes: twoReadAheads(cost),
    });
    const keys = await seed(f, 6);
    const gate = gatedStorage(f);
    const first = await f.service.read({ ...authority, storeId: 'store' });
    const second = await f.service.read({ ...authority, storeId: 'store' });
    const a = first.items.next();
    const b = second.items.next();
    await vi.waitFor(() =>
      expect(f.storage.getObject).toHaveBeenCalledTimes(4),
    );
    // Each read's next commit is free; only two read-aheads fit the budget.
    expect(gate.maxInflight).toBe(4);
    for (const key of keys) gate.release(key);
    await a;
    await b;
    await first.items.return(undefined);
    await second.items.return(undefined);
  });

  it('never blocks a read on an exhausted budget', async () => {
    const f = setup({ readConcurrency: 8, readAheadBytes: 0 });
    const keys = await seed(f, 4);
    const gate = gatedStorage(f);
    expect(await drain(f, gate, keys)).toHaveLength(4);
    expect(gate.maxInflight).toBe(1);
  });

  async function budgetFixture() {
    const probe = setup();
    await seed(probe, 1);
    const f = setup({
      readConcurrency: 8,
      readAheadBytes: twoReadAheads(readAheadCost(probe)),
    });
    const keys = await seed(f, 4);
    const fullReadAhead = async () => {
      const gate = gatedStorage(f);
      await drain(f, gate, keys);
      return gate.maxInflight;
    };
    expect(await fullReadAhead()).toBe(3);
    return { f, keys, fullReadAhead };
  }

  it('returns reservations after an early return', async () => {
    const { f, keys, fullReadAhead } = await budgetFixture();
    const gate = gatedStorage(f);
    const page = await f.service.read({ ...authority, storeId: 'store' });
    const head = page.items.next();
    await vi.waitFor(() => expect(gate.started(keys[2])).toBe(true));
    gate.release(keys[0]);
    await head;
    await page.items.return(undefined);
    expect(await fullReadAhead()).toBe(3);
  });

  it('returns reservations after a caller abort', async () => {
    const { f, keys, fullReadAhead } = await budgetFixture();
    const gate = gatedStorage(f);
    const controller = new AbortController();
    const page = await f.service.read({
      ...authority,
      storeId: 'store',
      signal: controller.signal,
    });
    const aborted = collect(page.items);
    await vi.waitFor(() => expect(gate.started(keys[2])).toBe(true));
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(await fullReadAhead()).toBe(3);
  });

  it('returns reservations after a failed read-ahead object', async () => {
    const { f, keys, fullReadAhead } = await budgetFixture();
    gatedStorage(f);
    const gated = f.storage.getObject.getMockImplementation()!;
    f.storage.getObject.mockClear();
    f.storage.getObject.mockImplementation(async (key: string, signal) => {
      if (key === keys[1]) throw new Error('object store unavailable');
      return gated(key, signal);
    });
    const page = await f.service.read({ ...authority, storeId: 'store' });
    await expect(collect(page.items)).rejects.toThrow(
      'object store unavailable',
    );
    // The head plus both read-aheads started; nothing after the failure.
    expect(f.storage.getObject).toHaveBeenCalledTimes(3);
    expect(await fullReadAhead()).toBe(3);
  });

  it('lets another read reuse budget a finished read released', async () => {
    const probe = setup();
    await seed(probe, 1);
    const f = setup({
      readConcurrency: 8,
      readAheadBytes: twoReadAheads(readAheadCost(probe)),
    });
    const keys = await seed(f, 4);
    const gate = gatedStorage(f);
    const a = await f.service.read({ ...authority, storeId: 'store' });
    const b = await f.service.read({ ...authority, storeId: 'store' });
    const aFirst = a.items.next();
    const bFirst = b.items.next();
    // A holds both read-ahead slots; B only has its free next commit.
    await vi.waitFor(() =>
      expect(f.storage.getObject).toHaveBeenCalledTimes(4),
    );
    gate.release(keys[0]);
    await aFirst;
    await bFirst;
    const bSecond = b.items.next();
    await vi.waitFor(() =>
      expect(f.storage.getObject).toHaveBeenCalledTimes(5),
    );
    // A finishes early and returns its two reservations.
    await a.items.return(undefined);
    gate.release(keys[1]);
    await bSecond;
    const bThird = b.items.next();
    // B's next commit is free; the read-ahead behind it uses A's budget.
    await vi.waitFor(() =>
      expect(f.storage.getObject).toHaveBeenCalledTimes(7),
    );
    expect(f.storage.getObject.mock.calls.slice(5).map(([key]) => key)).toEqual(
      [keys[2], keys[3]],
    );
    gate.release(keys[2]);
    gate.release(keys[3]);
    await bThird;
    await b.items.return(undefined);
  });

  it('rejects an invalid read-ahead budget', () => {
    expect(() => setup({ readAheadBytes: -1 })).toThrow(RangeError);
  });
});
