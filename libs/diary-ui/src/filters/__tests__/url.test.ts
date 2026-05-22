import { describe, expect, it } from 'vitest';

import { DEFAULT_WEIGHTS, EMPTY_FILTER_STATE } from '../../types.js';
import {
  parseDiaryFiltersFromQuery,
  serializeDiaryFiltersToQuery,
} from '../url.js';

describe('parseDiaryFiltersFromQuery', () => {
  it('returns empty state for empty query', () => {
    expect(parseDiaryFiltersFromQuery('')).toEqual(EMPTY_FILTER_STATE);
  });

  it('parses q, tags, excludeTags, types, view', () => {
    const state = parseDiaryFiltersFromQuery(
      'q=auth&tags=a,b&excludeTags=c&types=semantic,episodic&view=timeline',
    );
    expect(state).toEqual({
      q: 'auth',
      tags: ['a', 'b'],
      excludeTags: ['c'],
      types: ['semantic', 'episodic'],
      view: 'timeline',
      weights: null,
    });
  });

  it('treats tag= as back-compat alias for tags=', () => {
    expect(parseDiaryFiltersFromQuery('tag=foo').tags).toEqual(['foo']);
  });

  it('treats type= as back-compat alias for types=', () => {
    expect(parseDiaryFiltersFromQuery('type=semantic').types).toEqual([
      'semantic',
    ]);
  });

  it('drops unknown entry types', () => {
    expect(parseDiaryFiltersFromQuery('types=semantic,bogus').types).toEqual([
      'semantic',
    ]);
  });

  it('parses weights when q is present', () => {
    const state = parseDiaryFiltersFromQuery(
      'q=x&wRelevance=2&wRecency=0.1&wImportance=0',
    );
    expect(state.weights).toEqual({
      relevance: 2,
      recency: 0.1,
      importance: 0,
    });
  });

  it('ignores weights when q is absent', () => {
    expect(parseDiaryFiltersFromQuery('wRelevance=2').weights).toBeNull();
  });

  it('round-trips through serialize', () => {
    const original = {
      q: 'foo bar',
      tags: ['x', 'y'],
      excludeTags: ['z'],
      types: ['semantic'] as const,
      view: 'timeline' as const,
      weights: { relevance: 2, recency: 0.1, importance: 0 },
    };
    const qs = serializeDiaryFiltersToQuery(original);
    expect(parseDiaryFiltersFromQuery(qs)).toEqual(original);
  });
});

describe('serializeDiaryFiltersToQuery', () => {
  it('returns empty string for empty state', () => {
    expect(serializeDiaryFiltersToQuery(EMPTY_FILTER_STATE)).toBe('');
  });

  it('omits weights when state.weights is null', () => {
    expect(
      serializeDiaryFiltersToQuery({ ...EMPTY_FILTER_STATE, q: 'x' }),
    ).toBe('?q=x');
  });

  it('omits weights when they equal defaults', () => {
    expect(
      serializeDiaryFiltersToQuery({
        ...EMPTY_FILTER_STATE,
        q: 'x',
        weights: DEFAULT_WEIGHTS,
      }),
    ).toBe('?q=x');
  });

  it('omits view when it equals grid (default)', () => {
    expect(
      serializeDiaryFiltersToQuery({ ...EMPTY_FILTER_STATE, view: 'grid' }),
    ).toBe('');
  });
});
