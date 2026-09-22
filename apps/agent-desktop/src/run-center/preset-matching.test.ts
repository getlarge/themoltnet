import { describe, expect, it } from 'vitest';

import { preset, status } from './composer-fixtures.test-support.js';
import { findRunPreset } from './preset-matching.js';

describe('preset attribution across changing defaults', () => {
  const run = {
    ...status.runs[0],
    agent: preset.agent,
    profiles: preset.profileIds,
    taskTypes: preset.taskTypes,
    diaryId: 'new-default',
  };
  it('matches null diary presets and old default snapshots', () => {
    expect(
      findRunPreset([{ ...preset, version: 2, diaryId: null }], run)?.id,
    ).toBe(preset.id);
    expect(findRunPreset([preset], run)?.id).toBe(preset.id);
  });
  it('respects explicit diary choices and ordered profiles', () => {
    expect(findRunPreset([{ ...preset, version: 2 }], run)).toBeUndefined();
    expect(
      findRunPreset([{ ...preset, profileIds: ['different'] }], run),
    ).toBeUndefined();
  });
});
