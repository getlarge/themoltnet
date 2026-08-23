import { describe, expect, it, vi } from 'vitest';

import {
  type KetoTuple,
  purgeTaskParentRelations,
  type TaskParentPurgeAdapters,
} from './task-parent-purge.js';

function parentTuple(index: number): KetoTuple {
  return {
    namespace: 'Task',
    object: `task-${index}`,
    relation: 'parent',
    subject_set: {
      namespace: 'Diary',
      object: `diary-${index}`,
      relation: '',
    },
  };
}

function adapters(initial: KetoTuple[]): TaskParentPurgeAdapters & {
  deleteTuples: ReturnType<typeof vi.fn>;
} {
  const tuples = [...initial];
  return {
    listParentTuples: vi.fn(async () => ({ items: [...tuples] })),
    deleteTuples: vi.fn(async (batch: KetoTuple[]) => {
      const keys = new Set(batch.map((tuple) => tuple.object));
      for (let index = tuples.length - 1; index >= 0; index--) {
        if (keys.has(tuples[index].object)) tuples.splice(index, 1);
      }
    }),
  };
}

describe('task parent relationship purge', () => {
  it('keeps dry-run pure and reports every tuple', async () => {
    const api = adapters([parentTuple(1), parentTuple(2)]);

    await expect(
      purgeTaskParentRelations(api, 'dry-run'),
    ).resolves.toMatchObject({
      found: 2,
      deleted: 0,
      remaining: [parentTuple(1), parentTuple(2)],
    });
    expect(api.deleteTuples).not.toHaveBeenCalled();
  });

  it('deletes in bounded batches, verifies, and is idempotent', async () => {
    vi.useFakeTimers();
    try {
      const api = adapters(
        Array.from({ length: 101 }, (_, index) => parentTuple(index)),
      );
      const first = purgeTaskParentRelations(api, 'apply');
      await vi.runAllTimersAsync();

      await expect(first).resolves.toMatchObject({ found: 101, deleted: 101 });
      expect(api.deleteTuples).toHaveBeenCalledTimes(2);
      expect(api.deleteTuples.mock.calls[0][0]).toHaveLength(100);
      expect(api.deleteTuples.mock.calls[1][0]).toHaveLength(1);
      await expect(
        purgeTaskParentRelations(api, 'apply'),
      ).resolves.toMatchObject({
        found: 0,
        deleted: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails verification while parent tuples remain', async () => {
    await expect(
      purgeTaskParentRelations(adapters([parentTuple(1)]), 'verify'),
    ).rejects.toThrow('verification incomplete');
  });

  it('rejects unreadable, looping, or unexpected pages', async () => {
    const unreadable = adapters([]);
    unreadable.listParentTuples = vi.fn(async () => undefined as never);
    await expect(
      purgeTaskParentRelations(unreadable, 'dry-run'),
    ).rejects.toThrow('Unreadable');

    const looping = adapters([]);
    looping.listParentTuples = vi.fn(async () => ({
      items: [],
      nextPageToken: 'same',
    }));
    await expect(purgeTaskParentRelations(looping, 'dry-run')).rejects.toThrow(
      'repeated',
    );

    const unexpected = adapters([]);
    unexpected.listParentTuples = vi.fn(async () => ({
      items: [{ ...parentTuple(1), relation: 'writers' }],
    }));
    await expect(
      purgeTaskParentRelations(unexpected, 'dry-run'),
    ).rejects.toThrow('Unexpected tuple');
  });
});
