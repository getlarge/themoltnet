import type { Agent, TasksNamespace } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createApiSourceAttemptResolver } from './source-attempts.js';

describe('createApiSourceAttemptResolver', () => {
  function makeAgent(attempts: unknown[]): Agent {
    const listAttempts = vi.fn<TasksNamespace['listAttempts']>();
    listAttempts.mockResolvedValue(attempts as never);
    return { tasks: { listAttempts } } as unknown as Agent;
  }

  it('returns the completed source attempt branch', async () => {
    const agent = makeAgent([
      { attemptN: 1, status: 'completed', output: { branch: 'feature/x' } },
    ]);
    const resolver = createApiSourceAttemptResolver({ agent });

    await expect(
      resolver.findOutputBranch({ taskId: 'task-1', attemptN: 1 }),
    ).resolves.toBe('feature/x');
  });

  it('returns null when the source attempt is not completed', async () => {
    const agent = makeAgent([
      { attemptN: 1, status: 'running', output: { branch: 'feature/x' } },
    ]);
    const resolver = createApiSourceAttemptResolver({ agent });

    await expect(
      resolver.findOutputBranch({ taskId: 'task-1', attemptN: 1 }),
    ).resolves.toBeNull();
  });

  it('returns null when the source output has no branch', async () => {
    const agent = makeAgent([
      { attemptN: 1, status: 'completed', output: { summary: 'done' } },
    ]);
    const resolver = createApiSourceAttemptResolver({ agent });

    await expect(
      resolver.findOutputBranch({ taskId: 'task-1', attemptN: 1 }),
    ).resolves.toBeNull();
  });
});
