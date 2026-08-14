import { describe, expect, it, vi } from 'vitest';

import {
  backfillTaskOwnership,
  type KetoTuple,
  type TaskOwnershipBackfillAdapters,
} from './task-ownership-backfill.js';

const task = { id: 'task-1', teamId: 'team-1', diaryId: 'diary-1' };
const diaryGrant: KetoTuple = {
  namespace: 'Diary',
  object: 'diary-1',
  relation: 'writers',
  subject_set: { namespace: 'Group', object: 'group-1', relation: 'members' },
};

function adapters(
  existing: KetoTuple[] = [],
): TaskOwnershipBackfillAdapters & { putTuple: ReturnType<typeof vi.fn> } {
  const tuples = [...existing];
  const putTuple = vi.fn(async (tuple: KetoTuple) => {
    tuples.push(tuple);
  });
  return {
    listTasks: vi.fn(async (cursor?: string) => {
      return cursor
        ? { items: [task] }
        : { items: [], nextPageToken: 'tasks-2' };
    }),
    listTuples: vi.fn(async ({ namespace, relation, pageToken }) => {
      const matches = [diaryGrant, ...tuples].filter(
        (tuple) => tuple.namespace === namespace && tuple.relation === relation,
      );
      if (!pageToken && matches.length > 0)
        return { items: [], nextPageToken: 'tuples-2' };
      return { items: matches };
    }),
    putTuple,
  };
}

describe('task ownership backfill', () => {
  it('keeps dry-run pure and preserves Group#members semantics across pages', async () => {
    const api = adapters();
    const result = await backfillTaskOwnership(api, 'dry-run');
    expect(result.missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: 'team' }),
        expect.objectContaining({
          relation: 'writers',
          subject_set: diaryGrant.subject_set,
        }),
      ]),
    );
    expect(api.putTuple).not.toHaveBeenCalled();
  });

  it('applies missing tuples, verifies, and is idempotent', async () => {
    const api = adapters();
    await expect(backfillTaskOwnership(api, 'apply')).resolves.toMatchObject({
      inserted: 2,
    });
    await expect(backfillTaskOwnership(api, 'apply')).resolves.toMatchObject({
      inserted: 0,
      missing: [],
    });
  });

  it('allows a transferred provenance diary because database team remains canonical', async () => {
    const api = adapters([
      {
        namespace: 'Diary',
        object: 'diary-1',
        relation: 'team',
        subject_set: { namespace: 'Team', object: 'team-2', relation: '' },
      },
    ]);
    const result = await backfillTaskOwnership(api, 'dry-run');
    expect(
      result.missing.find((tuple) => tuple.relation === 'team')?.subject_set
        .object,
    ).toBe('team-1');
  });

  it('aborts on conflicting team tuples, null teams, and incomplete verification', async () => {
    const conflict = adapters([
      {
        namespace: 'Task',
        object: 'task-1',
        relation: 'team',
        subject_set: { namespace: 'Team', object: 'team-2', relation: '' },
      },
    ]);
    await expect(backfillTaskOwnership(conflict, 'dry-run')).rejects.toThrow(
      'Conflicting',
    );
    const nullable = adapters();
    nullable.listTasks = vi.fn(async () => ({
      items: [{ ...task, teamId: null }],
    }));
    await expect(backfillTaskOwnership(nullable, 'dry-run')).rejects.toThrow(
      'null team_id',
    );
    await expect(backfillTaskOwnership(adapters(), 'verify')).rejects.toThrow(
      'verification incomplete',
    );
  });

  it('aborts on unreadable or looping Keto pagination', async () => {
    const unreadable = adapters();
    unreadable.listTuples = vi.fn(async () => undefined as never);
    await expect(backfillTaskOwnership(unreadable, 'dry-run')).rejects.toThrow(
      'Unreadable',
    );
    const looping = adapters();
    looping.listTuples = vi.fn(async () => ({
      items: [],
      nextPageToken: 'same',
    }));
    await expect(backfillTaskOwnership(looping, 'dry-run')).rejects.toThrow(
      'repeated',
    );
  });
});
