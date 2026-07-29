import { describe, expect, it, vi } from 'vitest';

import { resolvePriorContext } from './resolve-prior-context.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';

function makeAttempt(overrides: Record<string, unknown> = {}) {
  return {
    taskId: TASK_ID,
    attemptN: 1,
    claimedByAgentId: AGENT_ID,
    runtimeId: null,
    claimedAt: '2026-06-04T00:00:00.000Z',
    startedAt: '2026-06-04T00:00:01.000Z',
    completedAt: '2026-06-04T00:00:02.000Z',
    status: 'succeeded',
    output: null,
    outputCid: null,
    claimedExecutorFingerprint: null,
    claimedExecutorManifest: null,
    completedExecutorFingerprint: null,
    completedExecutorManifest: null,
    error: null,
    usage: null,
    contentSignature: null,
    signedAt: null,
    daemonState: null,
    ...overrides,
  };
}

function makeAgent(attempts: ReturnType<typeof makeAttempt>[]) {
  const tasks = {
    listAttempts: vi.fn(async (_id: string) => attempts),
  };
  return { tasks } as unknown as {
    tasks: {
      listAttempts: ReturnType<typeof vi.fn>;
    };
  };
}

describe('resolvePriorContext', () => {
  it('returns summary + artifacts projected from the source attempt output', async () => {
    const agent = makeAgent([
      makeAttempt({
        attemptN: 1,
        output: {
          summary: 'Done.',
          artifacts: [
            { kind: 'markdown', title: 'notes', body: 'body content' },
            {
              kind: 'json',
              title: 'data',
              description: 'ignored',
              url: 'https://x',
            },
          ],
        },
      }),
    ]);
    const resolved = await resolvePriorContext(agent as never, {
      taskId: TASK_ID,
      attemptN: 1,
    });
    expect(resolved).toEqual({
      summary: 'Done.',
      artifacts: [
        { kind: 'markdown', title: 'notes', body: 'body content' },
        { kind: 'json', title: 'data', body: undefined },
      ],
    });
    expect(agent.tasks.listAttempts).toHaveBeenCalledWith(TASK_ID);
  });

  it('matches by attemptN even when other attempts exist', async () => {
    const agent = makeAgent([
      makeAttempt({ attemptN: 1, output: { summary: 'first' } }),
      makeAttempt({ attemptN: 2, output: { summary: 'second' } }),
    ]);
    const resolved = await resolvePriorContext(agent as never, {
      taskId: TASK_ID,
      attemptN: 2,
    });
    expect(resolved?.summary).toBe('second');
  });

  it('returns null when the attempt is not found', async () => {
    const agent = makeAgent([makeAttempt({ attemptN: 1 })]);
    const resolved = await resolvePriorContext(agent as never, {
      taskId: TASK_ID,
      attemptN: 99,
    });
    expect(resolved).toBeNull();
  });

  it('returns null when the attempt has no output', async () => {
    const agent = makeAgent([makeAttempt({ attemptN: 1, output: null })]);
    const resolved = await resolvePriorContext(agent as never, {
      taskId: TASK_ID,
      attemptN: 1,
    });
    expect(resolved).toBeNull();
  });

  it('returns null when output has neither summary nor artifacts', async () => {
    const agent = makeAgent([makeAttempt({ attemptN: 1, output: {} })]);
    const resolved = await resolvePriorContext(agent as never, {
      taskId: TASK_ID,
      attemptN: 1,
    });
    expect(resolved).toBeNull();
  });
});
