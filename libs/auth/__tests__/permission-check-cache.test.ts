import type { PermissionApi, RelationshipApi } from '@ory/client-fetch';
import { describe, expect, it, vi } from 'vitest';

import { KetoNamespace } from '../src/keto-constants.js';
import {
  PermissionCheckCache,
  type PermissionTuple,
} from '../src/permission-check-cache.js';
import { createPermissionChecker } from '../src/permission-checker.js';
import { createRelationshipWriter } from '../src/relationship-writer.js';

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

  it('shares in-flight checks and does not restore a pre-revocation result', async () => {
    const cache = new PermissionCheckCache();
    let resolve!: (allowed: boolean) => void;
    const load = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          resolve = r;
        }),
    );
    const first = cache.check(tuple('a'), load);
    const second = cache.check(tuple('a'), load);
    expect(load).toHaveBeenCalledTimes(1);
    cache.invalidate();
    resolve(true);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    const replacement = vi.fn().mockResolvedValue(false);
    expect(await cache.check(tuple('a'), replacement)).toBe(false);
    expect(replacement).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(1);
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

  it('invalidates cached permissions after a successful local relationship write', async () => {
    const cache = new PermissionCheckCache();
    const permissionApi = {
      checkPermission: vi.fn().mockResolvedValue({ allowed: true }),
    } as unknown as PermissionApi;
    const relationshipApi = {
      deleteRelationships: vi.fn().mockResolvedValue({}),
    } as unknown as RelationshipApi;
    const checker = createPermissionChecker(permissionApi, undefined, cache);
    const writer = createRelationshipWriter(
      relationshipApi,
      relationshipApi,
      cache,
    );

    await checker.canViewTask('task-1', 'agent-1', KetoNamespace.Agent);
    await checker.canViewTask('task-1', 'agent-1', KetoNamespace.Agent);
    expect(permissionApi.checkPermission).toHaveBeenCalledTimes(1);
    await writer.removeTaskClaimant('task-1', 'agent-1');
    await checker.canViewTask('task-1', 'agent-1', KetoNamespace.Agent);
    expect(permissionApi.checkPermission).toHaveBeenCalledTimes(2);
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

  it('invalidates after a partial batch write fails', async () => {
    const cache = new PermissionCheckCache();
    const permissionApi = {
      checkPermission: vi
        .fn()
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce({ allowed: false }),
    } as unknown as PermissionApi;
    const taskIds = Array.from({ length: 101 }, (_, i) => `task-${i}`);
    const relationshipApi = {
      getRelationships: vi.fn().mockResolvedValue({
        relation_tuples: taskIds.map((id) => ({
          namespace: KetoNamespace.Task,
          object: id,
          relation: 'team',
          subject_set: {
            namespace: KetoNamespace.Team,
            object: 'team-1',
            relation: '',
          },
        })),
      }),
      patchRelationships: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('second patch failed')),
    } as unknown as RelationshipApi;
    const checker = createPermissionChecker(permissionApi, undefined, cache);
    const writer = createRelationshipWriter(
      relationshipApi,
      relationshipApi,
      cache,
    );

    expect(
      await checker.canViewTask('task-0', 'agent-1', KetoNamespace.Agent),
    ).toBe(true);
    await expect(
      writer.removeTaskRelationsBatch(taskIds.map((id) => ({ id }))),
    ).rejects.toThrow('second patch failed');
    expect(
      await checker.canViewTask('task-0', 'agent-1', KetoNamespace.Agent),
    ).toBe(false);
    expect(permissionApi.checkPermission).toHaveBeenCalledTimes(2);
    expect(relationshipApi.patchRelationships).toHaveBeenCalledTimes(2);
  });

  it('invalidates after a failed Keto write whose outcome is uncertain', async () => {
    const cache = new PermissionCheckCache();
    const permissionApi = {
      checkPermission: vi
        .fn()
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce({ allowed: false }),
    } as unknown as PermissionApi;
    const relationshipApi = {
      deleteRelationships: vi
        .fn()
        .mockRejectedValue(new Error('connection reset')),
    } as unknown as RelationshipApi;
    const checker = createPermissionChecker(permissionApi, undefined, cache);
    const writer = createRelationshipWriter(
      relationshipApi,
      relationshipApi,
      cache,
    );

    expect(
      await checker.canViewTask('task-1', 'agent-1', KetoNamespace.Agent),
    ).toBe(true);
    await expect(
      writer.removeTaskClaimant('task-1', 'agent-1'),
    ).rejects.toThrow('connection reset');
    expect(
      await checker.canViewTask('task-1', 'agent-1', KetoNamespace.Agent),
    ).toBe(false);
    expect(permissionApi.checkPermission).toHaveBeenCalledTimes(2);
  });

  it('keeps unrelated cache entries after a writer no-op', async () => {
    const cache = new PermissionCheckCache();
    const permissionApi = {
      checkPermission: vi.fn().mockResolvedValue({ allowed: true }),
    } as unknown as PermissionApi;
    const relationshipApi = {
      patchRelationships: vi.fn(),
    } as unknown as RelationshipApi;
    const checker = createPermissionChecker(permissionApi, undefined, cache);
    const writer = createRelationshipWriter(
      relationshipApi,
      relationshipApi,
      cache,
    );

    await checker.canViewTask('task-1', 'agent-1', KetoNamespace.Agent);
    await writer.removeTaskRelationsBatch([]);
    await writer.writeRuntimePolicyEdges('policy-1', {});
    expect(
      await checker.canViewTask('task-1', 'agent-1', KetoNamespace.Agent),
    ).toBe(true);
    expect(permissionApi.checkPermission).toHaveBeenCalledTimes(1);
    expect(relationshipApi.patchRelationships).not.toHaveBeenCalled();
  });
});
