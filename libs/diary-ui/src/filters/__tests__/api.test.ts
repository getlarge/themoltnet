import { describe, expect, it } from 'vitest';

import { EMPTY_FILTER_STATE } from '../../types.js';
import { toListEntriesArgs, toSearchDiaryArgs } from '../api.js';

const DIARY_ID = 'd1';

describe('toListEntriesArgs', () => {
  it('maps tags/excludeTags/types and pagination', () => {
    expect(
      toListEntriesArgs(
        {
          ...EMPTY_FILTER_STATE,
          tags: ['a', 'b'],
          excludeTags: ['c'],
          types: ['semantic'],
        },
        DIARY_ID,
        { limit: 20, offset: 40 },
      ),
    ).toEqual({
      diaryId: DIARY_ID,
      limit: 20,
      offset: 40,
      tags: ['a', 'b'],
      excludeTags: ['c'],
      entryType: ['semantic'],
    });
  });

  it('omits empty arrays', () => {
    expect(
      toListEntriesArgs(EMPTY_FILTER_STATE, DIARY_ID, {
        limit: 20,
        offset: 0,
      }),
    ).toEqual({ diaryId: DIARY_ID, limit: 20, offset: 0 });
  });
});

describe('toSearchDiaryArgs', () => {
  it('scopes to diaryId and passes weights', () => {
    expect(
      toSearchDiaryArgs(
        {
          ...EMPTY_FILTER_STATE,
          q: 'auth',
          tags: ['a'],
          excludeTags: ['b'],
          types: ['semantic', 'episodic'],
          weights: { relevance: 1, recency: 0.3, importance: 0.5 },
        },
        DIARY_ID,
        { limit: 50, offset: 0 },
      ),
    ).toEqual({
      diaryId: DIARY_ID,
      query: 'auth',
      tags: ['a'],
      excludeTags: ['b'],
      entryTypes: ['semantic', 'episodic'],
      wRelevance: 1,
      wRecency: 0.3,
      wImportance: 0.5,
      limit: 50,
      offset: 0,
    });
  });

  it('omits weights and arrays when not present', () => {
    expect(
      toSearchDiaryArgs({ ...EMPTY_FILTER_STATE, q: 'auth' }, DIARY_ID, {
        limit: 50,
        offset: 0,
      }),
    ).toEqual({
      diaryId: DIARY_ID,
      query: 'auth',
      limit: 50,
      offset: 0,
    });
  });
});
