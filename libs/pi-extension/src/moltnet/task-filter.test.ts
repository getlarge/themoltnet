import { describe, expect, it } from 'vitest';

import { compileTaskFilterTags } from './tools.js';

describe('compileTaskFilterTags', () => {
  it('returns an empty array when no filter is supplied', () => {
    expect(compileTaskFilterTags(undefined)).toEqual([]);
    expect(compileTaskFilterTags({})).toEqual([]);
  });

  it('expands taskId into the namespaced tag', () => {
    expect(compileTaskFilterTags({ taskId: 'abc' })).toEqual(['task:id:abc']);
  });

  it('expands taskType into the namespaced tag', () => {
    expect(compileTaskFilterTags({ taskType: 'fulfill_brief' })).toEqual([
      'task:type:fulfill_brief',
    ]);
  });

  it('expands correlationId into the namespaced tag', () => {
    expect(compileTaskFilterTags({ correlationId: 'corr-1' })).toEqual([
      'task:correlation:corr-1',
    ]);
  });

  it('expands attemptN into the namespaced tag (number, not string)', () => {
    expect(compileTaskFilterTags({ attemptN: 2 })).toEqual(['task:attempt:2']);
    // attemptN: 0 must still be encoded — common when tasks index from 0
    expect(compileTaskFilterTags({ attemptN: 0 })).toEqual(['task:attempt:0']);
  });

  it('combines multiple fields into AND-able tags', () => {
    expect(
      compileTaskFilterTags({
        taskType: 'assess_brief',
        correlationId: 'c',
        attemptN: 1,
      }),
    ).toEqual([
      'task:type:assess_brief',
      'task:correlation:c',
      'task:attempt:1',
    ]);
  });

  it('omits keys that are not provided (no empty-string tags)', () => {
    const out = compileTaskFilterTags({ taskId: 'x' });
    expect(out).not.toContain('task:type:');
    expect(out).not.toContain('task:correlation:');
    expect(out).not.toContain('task:attempt:');
  });
});
