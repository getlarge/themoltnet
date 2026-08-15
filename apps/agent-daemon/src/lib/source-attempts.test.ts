import type { Agent, TasksNamespace } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createApiSourceAttemptResolver } from './source-attempts.js';

describe('createApiSourceAttemptResolver', () => {
  function makeAgent(attempts: unknown[]) {
    const listAttempts = vi.fn<TasksNamespace['listAttempts']>();
    listAttempts.mockResolvedValue(attempts as never);
    const get = vi.fn<TasksNamespace['get']>();
    get.mockResolvedValue({
      acceptedAttemptN: 1,
      input: {},
      status: 'completed',
    } as never);
    const agent = { tasks: { get, listAttempts } } as unknown as Agent;
    return { agent, get, listAttempts };
  }

  it('returns the completed source attempt branch', async () => {
    const { agent, listAttempts } = makeAgent([
      { attemptN: 1, status: 'completed', output: { branch: 'feature/x' } },
    ]);
    const resolver = createApiSourceAttemptResolver({ agent });

    await expect(
      resolver.findOutputBranch({
        taskId: 'task-1',
        attemptN: 1,
        teamId: 'team-1',
      }),
    ).resolves.toBe('feature/x');
    expect(listAttempts).toHaveBeenCalledWith('task-1', {
      teamId: 'team-1',
    });
  });

  it('returns null when the source attempt is not completed', async () => {
    const { agent } = makeAgent([
      { attemptN: 1, status: 'running', output: { branch: 'feature/x' } },
    ]);
    const resolver = createApiSourceAttemptResolver({ agent });

    await expect(
      resolver.findOutputBranch({
        taskId: 'task-1',
        attemptN: 1,
        teamId: 'team-1',
      }),
    ).resolves.toBeNull();
  });

  it('returns null when the source output has no branch', async () => {
    const { agent } = makeAgent([
      { attemptN: 1, status: 'completed', output: { summary: 'done' } },
    ]);
    const resolver = createApiSourceAttemptResolver({ agent });

    await expect(
      resolver.findOutputBranch({
        taskId: 'task-1',
        attemptN: 1,
        teamId: 'team-1',
      }),
    ).resolves.toBeNull();
  });

  it('returns the immutable revision from an accepted source task', async () => {
    const revision = 'A'.repeat(40);
    const { agent, get } = makeAgent([]);
    get.mockResolvedValue({
      acceptedAttemptN: 2,
      input: { execution: { revision } },
      status: 'completed',
    } as never);
    const resolver = createApiSourceAttemptResolver({ agent });

    await expect(
      resolver.findInputRevision({
        taskId: 'task-1',
        attemptN: 2,
        teamId: 'team-1',
      }),
    ).resolves.toBe(revision.toLowerCase());
    expect(get).toHaveBeenCalledWith('task-1', { teamId: 'team-1' });
  });

  it('does not return a revision from an unaccepted source attempt', async () => {
    const { agent, get } = makeAgent([]);
    get.mockResolvedValue({
      acceptedAttemptN: 2,
      input: { execution: { revision: 'a'.repeat(40) } },
      status: 'completed',
    } as never);
    const resolver = createApiSourceAttemptResolver({ agent });

    await expect(
      resolver.findInputRevision({
        taskId: 'task-1',
        attemptN: 1,
        teamId: 'team-1',
      }),
    ).resolves.toBeNull();
  });
});
