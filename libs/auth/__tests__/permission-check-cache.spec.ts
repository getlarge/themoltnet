import type { PermissionApi } from '@ory/client-fetch';
import { describe, expect, it, vi } from 'vitest';

import { KetoNamespace } from '../src/keto-constants.js';
import {
  PermissionCheckCache,
  type PermissionTuple,
} from '../src/permission-check-cache.js';
import { createPermissionChecker } from '../src/permission-checker.js';

const tuple = (object: string, relation = 'view'): PermissionTuple => ({
  namespace: 'Task',
  object,
  relation,
  subject_set: { namespace: 'Agent', object: 'agent-1', relation: '' },
});

describe('PermissionCheckCache', () => {
  it('reuses positive decisions until TTL and never keeps denials or errors', async () => {
    let now = 0;
    const cache = new PermissionCheckCache({ ttlMs: 30, now: () => now });
    const load = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('Keto failed'))
      .mockResolvedValue(true);

    expect(await cache.check(tuple('a'), load)).toBe(true);
    expect(await cache.check(tuple('a'), load)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    now = 30;
    expect(await cache.check(tuple('a'), load)).toBe(false);
    await expect(cache.check(tuple('a'), load)).rejects.toThrow('Keto failed');
    expect(await cache.check(tuple('a'), load)).toBe(true);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('treats zero TTL as no retained result', async () => {
    const cache = new PermissionCheckCache({ ttlMs: 0 });
    const load = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    expect(await cache.check(tuple('a'), load)).toBe(true);
    expect(await cache.check(tuple('a'), load)).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('bounds LRU size and bypasses sensitive relations', async () => {
    const cache = new PermissionCheckCache({ maxEntries: 2 });
    const load = vi.fn().mockResolvedValue(true);
    await cache.check(tuple('a'), load);
    await cache.check(tuple('b'), load);
    await cache.check(tuple('a'), load);
    await cache.check(tuple('c'), load);
    await cache.check(tuple('b'), load);
    await cache.check(tuple('a', 'manage'), load);
    await cache.check(tuple('a', 'manage'), load);
    expect(load).toHaveBeenCalledTimes(6);
  });

  it('caches allowed batch members, keeps denied members live, and shares single-flight', async () => {
    const cache = new PermissionCheckCache();
    const load = vi
      .fn()
      .mockResolvedValueOnce([true, false])
      .mockResolvedValue([true]);
    expect(await cache.batch([tuple('a'), tuple('b')], load)).toEqual([
      true,
      false,
    ]);
    expect(await cache.batch([tuple('a'), tuple('b')], load)).toEqual([
      true,
      true,
    ]);
    expect(load.mock.calls[1]?.[0]).toEqual([tuple('b')]);

    let resolve!: (values: boolean[]) => void;
    const deferred = vi.fn(
      () =>
        new Promise<boolean[]>((r) => {
          resolve = r;
        }),
    );
    const first = cache.batch([tuple('c')], deferred);
    const second = cache.batch([tuple('c')], deferred);
    expect(deferred).toHaveBeenCalledTimes(1);
    resolve([true]);
    expect(await Promise.all([first, second])).toEqual([[true], [true]]);
  });

  it('keeps batch result positions correct when sensitive checks are bypassed', async () => {
    const cache = new PermissionCheckCache();
    const load = vi.fn().mockResolvedValueOnce([true, false, true]);
    const checks = [tuple('a', 'manage'), tuple('b'), tuple('c', 'delete')];
    expect(await cache.batch(checks, load)).toEqual([true, false, true]);
    expect(
      await cache.batch(
        checks,
        vi.fn().mockResolvedValue([false, true, false]),
      ),
    ).toEqual([false, true, false]);
  });

  it('keeps subjects and namespaces isolated in cache keys', async () => {
    const cache = new PermissionCheckCache();
    const load = vi.fn().mockResolvedValue(true);
    const agent = tuple('task-1');
    const human = {
      ...agent,
      subject_set: { ...agent.subject_set, namespace: 'Human' },
    };
    await cache.check(agent, load);
    await cache.check(human, load);
    await cache.check({ ...agent, namespace: 'Diary' }, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('coalesces sensitive checks without retaining their result', async () => {
    const cache = new PermissionCheckCache();
    let resolve!: (allowed: boolean) => void;
    const load = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          resolve = r;
        }),
    );
    const first = cache.check(tuple('a', 'manage'), load);
    const second = cache.check(tuple('a', 'manage'), load);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(true);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    await cache.check(tuple('a', 'manage'), vi.fn().mockResolvedValue(false));
  });

  it('checks live with the legacy checker factory signature', async () => {
    const permissionApi = {
      checkPermission: vi
        .fn()
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce({ allowed: false }),
    } as unknown as PermissionApi;
    const checker = createPermissionChecker(permissionApi);

    expect(
      await checker.canViewTask('task-1', 'agent-1', KetoNamespace.Agent),
    ).toBe(true);
    expect(
      await checker.canViewTask('task-1', 'agent-1', KetoNamespace.Agent),
    ).toBe(false);
    expect(permissionApi.checkPermission).toHaveBeenCalledTimes(2);
  });
});
