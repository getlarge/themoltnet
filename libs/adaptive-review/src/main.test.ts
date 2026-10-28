import { expect, it, vi } from 'vitest';

import type { CliDeps } from './cli.js';

const mocks = vi.hoisted(() => ({
  listAttempts: vi.fn().mockResolvedValue([]),
  runAdaptiveStage: vi.fn().mockResolvedValue(0),
}));
vi.mock('@themoltnet/sdk/node', () => ({
  connect: vi.fn().mockImplementation(() =>
    Promise.resolve({
      tasks: { listAttempts: mocks.listAttempts },
    }),
  ),
}));
vi.mock('./config.js', () => ({ env: () => ({ ADAPTIVE_STAGE: 'review' }) }));
vi.mock('./cli.js', () => ({
  jsonLines: vi.fn(),
  PROFILE_ENV: {},
  pullRequestFiles: vi.fn(),
  reportStageFailure: vi.fn(),
  runAdaptiveStage: mocks.runAdaptiveStage,
}));

import './main.js';

it('reads attempts for a prior-job task with explicit team context', async () => {
  const deps = mocks.runAdaptiveStage.mock.calls[0][1] as CliDeps;
  const client = await deps.connect('review-team');
  await client.tasks.listAttempts('classifier-from-route-job');
  expect(mocks.listAttempts).toHaveBeenCalledWith('classifier-from-route-job', {
    teamId: 'review-team',
  });
});
