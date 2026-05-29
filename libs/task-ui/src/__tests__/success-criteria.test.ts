import { describe, expect, it } from 'vitest';

import {
  type AssertionRow,
  buildSuccessCriteria,
  EMPTY_SIDE_EFFECTS,
  opUsesMax,
  opUsesValue,
  type SideEffectsForm,
} from '../success-criteria.js';

function rows(...r: AssertionRow[]): AssertionRow[] {
  return r;
}

describe('buildSuccessCriteria', () => {
  it('returns undefined when nothing is authored', () => {
    expect(buildSuccessCriteria([], EMPTY_SIDE_EFFECTS)).toBeUndefined();
  });

  it('drops assertion rows with a blank path', () => {
    expect(
      buildSuccessCriteria(
        rows({ path: '  ', op: 'exists', value: '' }),
        EMPTY_SIDE_EFFECTS,
      ),
    ).toBeUndefined();
  });

  it('builds an exists assertion without a value', () => {
    const result = buildSuccessCriteria(
      rows({ path: 'commits.*.sha', op: 'exists', value: '' }),
      EMPTY_SIDE_EFFECTS,
    );
    expect(result).toEqual({
      version: 1,
      assertions: [{ id: 'a1', path: 'commits.*.sha', op: 'exists' }],
    });
  });

  it('coerces min-length to a number and in-range to a [min,max] tuple', () => {
    const result = buildSuccessCriteria(
      rows(
        { path: 'items', op: 'min-length', value: '3' },
        { path: 'score', op: 'in-range', value: '0', max: '1' },
      ),
      EMPTY_SIDE_EFFECTS,
    );
    expect(result?.assertions?.[0]).toEqual({
      id: 'a1',
      path: 'items',
      op: 'min-length',
      value: 3,
    });
    expect(result?.assertions?.[1]).toEqual({
      id: 'a2',
      path: 'score',
      op: 'in-range',
      value: [0, 1],
    });
  });

  it('keeps matches value as a raw regex string', () => {
    const result = buildSuccessCriteria(
      rows({ path: 'title', op: 'matches', value: '^RFC-\\d+' }),
      EMPTY_SIDE_EFFECTS,
    );
    expect(result?.assertions?.[0].value).toBe('^RFC-\\d+');
  });

  it('builds sideEffects only for set fields', () => {
    const sideEffects: SideEffectsForm = {
      diaryEntryRequired: true,
      diaryEntryTags: ['decision'],
      referencedEntries: '2',
    };
    const result = buildSuccessCriteria([], sideEffects);
    expect(result).toEqual({
      version: 1,
      sideEffects: {
        diaryEntryRequired: true,
        diaryEntryTags: ['decision'],
        referencedEntries: 2,
      },
    });
  });

  it('omits sideEffects entirely when none are set', () => {
    const result = buildSuccessCriteria(
      rows({ path: 'x', op: 'exists', value: '' }),
      EMPTY_SIDE_EFFECTS,
    );
    expect(result?.sideEffects).toBeUndefined();
  });

  it('exposes op capability helpers', () => {
    expect(opUsesValue('exists')).toBe(false);
    expect(opUsesValue('equals')).toBe(true);
    expect(opUsesMax('in-range')).toBe(true);
    expect(opUsesMax('min-length')).toBe(false);
  });
});
