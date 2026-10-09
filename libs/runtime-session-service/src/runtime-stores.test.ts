import { Readable } from 'node:stream';

import { KetoNamespace } from '@moltnet/auth';
import { describe, expect, it, vi } from 'vitest';

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
function setup() {
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
    lockAuthority: vi.fn(async () => ({
      task: { input: {}, claimExpiresAt: new Date(now + 300_000) },
      attempt: {},
    })),
    findAttempt: vi.fn(async () => binding),
    listAttempts: vi.fn(async () => [binding]),
    lock: vi.fn(async (team: string) => (team === 'team' ? { ...row } : null)),
    get: vi.fn(async () => ({ ...row })),
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
    getObject: vi.fn(async (key: string) => ({
      body: Readable.from([objects.get(key)!]),
    })),
    deleteObject: vi.fn(),
    deleteObjects: vi.fn(),
  };
  const permissionChecker = {
    canAccessTeam: vi.fn(async () => true),
    canViewTask: vi.fn(async () => true),
  };
  const deps = {
    repository,
    storage,
    permissionChecker,
    maxBytes: 100_000,
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

describe('runtime store publication', () => {
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
    expect(f.row.nextId).toBe(11);
    const page = await f.service.read({
      ...authority,
      storeId: handle.storeId,
    });
    expect((await collect(page.items))[0].writes).toEqual(writes);
    await expect(f.service.append({ ...commit, writes: [] })).rejects.toThrow(
      'Commit ID',
    );
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
    f.permissionChecker.canViewTask.mockResolvedValue(false);
    await expect(
      f.service.read({ ...authority, storeId: handle.storeId }),
    ).rejects.toThrow();
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
  it('fetches one verified commit at a time and stops on early return', async () => {
    const f = setup();
    const handle = await f.service.open(authority);
    for (let i = 0; i < 3; i++)
      await f.service.append({
        ...authority,
        ...handle,
        commitId: `commit-${i}`,
        expectedSeq: i,
        writes,
      });
    const page = await f.service.read({
      ...authority,
      storeId: handle.storeId,
    });
    expect(page.count).toBe(3);
    expect(f.storage.getObject).not.toHaveBeenCalled();
    for await (const commit of page.items) {
      expect(commit.seq).toBe(1);
      expect(commit.writes).toEqual(writes);
      break;
    }
    expect(f.storage.getObject).toHaveBeenCalledTimes(1);
  });
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}
