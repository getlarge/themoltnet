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

it('matches a preset only when run claim options match', () => {
  const scoped = {
    ...preset,
    mode: 'drain' as const,
    correlationId: '78fa1119-6126-44b4-b3aa-249e942ef53b',
    diaryIds: ['41c8030b-fc3f-44df-b84d-df2240087733'],
    pollIntervalMs: 750,
    maxPollIntervalMs: 5_000,
    waitForFirstTaskSec: 15,
    waitAfterTaskSec: 3,
  };
  const run = {
    ...status.runs[0],
    agent: scoped.agent,
    profiles: scoped.profileIds,
    taskTypes: scoped.taskTypes,
    mode: 'drain' as const,
    correlationId: scoped.correlationId,
    diaryIds: scoped.diaryIds,
    pollIntervalMs: 750,
    maxPollIntervalMs: 5_000,
    waitForFirstTaskSec: 15,
    waitAfterTaskSec: 3,
  };
  expect(findRunPreset([scoped], run)?.id).toBe(preset.id);
  expect(
    findRunPreset([scoped], { ...run, pollIntervalMs: 1_000 }),
  ).toBeUndefined();
});
