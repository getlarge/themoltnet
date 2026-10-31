import { describe, expect, it } from 'vitest';

import { loadSelectedEntries } from '../src/entry-loader.js';

describe('loadSelectedEntries', () => {
  const makeRow = (id: string, contentHash: string | null = 'bafyr...') => ({
    id,
    content: `Content for ${id}`,
    contentHash,
    importance: 5,
    createdAt: new Date('2026-01-01'),
  });

  const makeFetcher = (
    rows: ReturnType<typeof makeRow>[],
  ): Parameters<typeof loadSelectedEntries>[0] => ({
    fetchEntries: async (_diaryId: string, ids: string[]) =>
      rows.filter((r) => ids.includes(r.id)),
  });

  it('returns entries sorted by rank', async () => {
    const rows = [makeRow('a'), makeRow('b')];
    const result = await loadSelectedEntries(makeFetcher(rows), 'diary-1', [
      { entryId: 'b', rank: 2 },
      { entryId: 'a', rank: 1 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].rank).toBe(1);
    expect(result[0].row.id).toBe('a');
    expect(result[1].rank).toBe(2);
  });

  it('throws on duplicate entryId', async () => {
    await expect(
      loadSelectedEntries(makeFetcher([makeRow('a')]), 'diary-1', [
        { entryId: 'a', rank: 1 },
        { entryId: 'a', rank: 2 },
      ]),
    ).rejects.toThrow(/[Dd]uplicate.*entryId/);
  });

  it('throws on duplicate rank', async () => {
    await expect(
      loadSelectedEntries(
        makeFetcher([makeRow('a'), makeRow('b')]),
        'diary-1',
        [
          { entryId: 'a', rank: 1 },
          { entryId: 'b', rank: 1 },
        ],
      ),
    ).rejects.toThrow(/[Dd]uplicate.*rank/);
  });

  it('throws when entries are missing from diary', async () => {
    await expect(
      loadSelectedEntries(makeFetcher([makeRow('a')]), 'diary-1', [
        { entryId: 'a', rank: 1 },
        { entryId: 'missing', rank: 2 },
      ]),
    ).rejects.toThrow(/not found/);
  });

  it('throws when entry has no contentHash', async () => {
    await expect(
      loadSelectedEntries(makeFetcher([makeRow('a', null)]), 'diary-1', [
        { entryId: 'a', rank: 1 },
      ]),
    ).rejects.toThrow(/contentHash/);
  });
});
