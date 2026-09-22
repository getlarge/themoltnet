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

describe('preset attribution across project selection', () => {
  const general = {
    ...status.runs[0],
    agent: preset.agent,
    profiles: preset.profileIds,
    taskTypes: preset.taskTypes,
  };
  const projectPreset = {
    ...preset,
    version: 2 as const,
    diaryId: null,
    projectId: 'project',
    location: 'Laptop',
  };
  it('never labels a project run with a General preset or the reverse', () => {
    const projectRun = { ...general, projectId: 'project', location: 'Laptop' };
    expect(findRunPreset([preset], projectRun)).toBeUndefined();
    expect(findRunPreset([projectPreset], general)).toBeUndefined();
    expect(findRunPreset([projectPreset], projectRun)?.id).toBe(preset.id);
  });
  it('matches the request, not the workspace it resolved to', () => {
    const run = {
      ...general,
      projectId: 'project',
      location: 'Laptop',
      workspace: {
        projectId: 'project',
        location: 'Laptop',
        source: '/resolved',
        strategy: 'existing' as const,
      },
    };
    expect(findRunPreset([projectPreset], run)?.id).toBe(preset.id);
  });
});
