import type { Agent } from '@themoltnet/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatch, type DispatchContext } from './dispatch.js';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  createTask: vi.fn(),
  createAssessTask: vi.fn(),
  info: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@actions/core', () => ({
  info: mocks.info,
  setOutput: mocks.setOutput,
  warning: mocks.warning,
}));

vi.mock('@themoltnet/sdk', () => ({
  connect: mocks.connect,
}));

vi.mock('./create-task.js', () => ({
  createTask: mocks.createTask,
  createAssessTask: mocks.createAssessTask,
}));

const BASE_ENV = {
  MOLTNET_TEAM_ID: '11111111-1111-4111-8111-111111111111',
  MOLTNET_DIARY_ID: '22222222-2222-4222-8222-222222222222',
};

function issueCommentContext(body: string): DispatchContext {
  return {
    github: {} as DispatchContext['github'],
    env: { ...BASE_ENV, MOLTNET_TASK_TAGS: 'ci, source:github-actions\nci' },
    context: {
      payload: {
        comment: { body },
        issue: {
          number: 9,
          html_url: 'https://github.com/getlarge/themoltnet/issues/9',
          title: 'Add task tags',
          body: 'Issue body',
        },
        repository: {
          owner: { login: 'getlarge' },
          name: 'themolt.net',
        },
      },
    },
  };
}

describe('dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({} as Agent);
    mocks.createTask.mockResolvedValue({
      id: 'task-1',
      correlationId: 'correlation-1',
    });
  });

  it('passes action tags to mention-created fulfill tasks', async () => {
    await dispatch(issueCommentContext('@moltnet-fulfill please handle this'));

    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ['ci', 'source:github-actions'],
      }),
    );
  });
});
