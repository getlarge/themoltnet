import { describe, expect, it, vi } from 'vitest';

import { inlineContext } from './context.js';
import {
  type RecoveryGateDecision,
  type RecoveryGateInput,
  waitForRecoverableTask,
} from './recoverable-task.js';
import { FakeTasks, replayContext } from './testing.js';
import type { Logger, SdkTaskAttempt, TaskClient } from './types.js';

const body: Parameters<TaskClient['createTask']>[0] = {
  taskType: 'freeform',
  teamId: 'team',
  diaryId: 'diary',
  correlationId: '00000000-0000-4000-8000-000000000001',
  input: { brief: 'extract the fixed document' },
  maxAttempts: 1,
};

const parse = (output: unknown) => output as { done: boolean };

function setup(tasks: TaskClient, overrides: Record<string, unknown> = {}) {
  return {
    tasks,
    ctx: inlineContext,
    pollIntervalSec: 0,
    parse,
    frozenRequest: body,
    maxReplacements: 1,
    gateTimeoutMs: 100,
    checkpointPrefix: 'extract.2',
    recoveryGate: {
      identity: { name: 'test-rule', version: '1' },
      decide: vi.fn(
        (): Promise<RecoveryGateDecision> =>
          Promise.resolve({ verdict: 'approve', reasonCode: 'retryable' }),
      ),
    },
    ...overrides,
  };
}

describe('waitForRecoverableTask', () => {
  it('replaces one failed stage and reuses the gate and created task on replay', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, { done: true }]);
    const initial = await tasks.createTask(body);
    const ctx = replayContext('workflow-1');
    const gate = vi.fn(() =>
      Promise.resolve({
        verdict: 'approve' as const,
        reasonCode: 'retryable',
        engine: { name: 'rules', version: '1' },
      }),
    );
    const options = setup(tasks, {
      ctx,
      recoveryGate: {
        identity: { name: 'test-rule', version: '1' },
        decide: gate,
      },
    });

    const first = await waitForRecoverableTask(initial, options);
    ctx.resetForReplay();
    const replayed = await waitForRecoverableTask(initial, options);

    expect(first.kind).toBe('accepted');
    expect(replayed.kind).toBe('accepted');
    expect(first.chain.map(({ outcome }) => outcome.kind)).toEqual([
      'failed',
      'accepted',
    ]);
    expect(first.decisions[0]).toMatchObject({
      verdict: 'approve',
      gateIdentity: { name: 'test-rule', version: '1' },
      reasonCode: 'retryable',
      replacementTaskId: '00000000-0000-4000-8000-000000000002',
    });
    expect(first.decisions[0]?.decisionInputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(tasks.created).toEqual([body, body]);
    expect(tasks.creationOptions[1]?.idempotencyKey).toMatch(/^absurd:/);
    expect(ctx.checkpointNames).toEqual([
      'extract.2.recovery.1.decision',
      'extract.2.recovery.1.create',
    ]);
  });

  it('replays two replacements with distinct checkpoints, lineage, and all usage', async () => {
    const tasks = new FakeTasks([
      { __taskStatus: 'failed' },
      { __taskStatus: 'failed' },
      { done: true },
    ]);
    const initial = await tasks.createTask(body);
    const getTask = tasks.getTask.bind(tasks);
    tasks.getTask = async (id) => {
      const task = await getTask(id);
      return id.endsWith('000000000003')
        ? { ...task, acceptedAttemptN: 2 }
        : task;
    };
    const listAttempts = tasks.listAttempts.bind(tasks);
    tasks.listAttempts = async (id) => {
      const attempts = await listAttempts(id);
      const taskN = Number(id.slice(-12));
      const withUsage = attempts.map((attempt) => ({
        ...attempt,
        usage: { inputTokens: taskN, outputTokens: taskN * 2, model: 'test' },
      }));
      if (taskN !== 3) return withUsage;
      return [
        {
          ...withUsage[0],
          attemptN: 1,
          status: 'failed',
          usage: { inputTokens: 10, outputTokens: 20, model: 'test' },
        } as SdkTaskAttempt,
        { ...withUsage[0], attemptN: 2 } as SdkTaskAttempt,
      ];
    };
    const ctx = replayContext('two-replacements');
    const gate = vi.fn(() =>
      Promise.resolve({ verdict: 'approve' as const, reasonCode: 'retryable' }),
    );
    const options = setup(tasks, {
      ctx,
      maxReplacements: 2,
      recoveryGate: {
        identity: { name: 'test-rule', version: '1' },
        decide: gate,
      },
    });

    const first = await waitForRecoverableTask(initial, options);
    ctx.resetForReplay();
    const replayed = await waitForRecoverableTask(initial, options);

    expect(first.kind).toBe('accepted');
    expect(replayed.kind).toBe('accepted');
    expect(
      first.chain.map(({ replacementN, attempts }) => [
        replacementN,
        attempts.length,
      ]),
    ).toEqual([
      [0, 1],
      [1, 1],
      [2, 2],
    ]);
    expect(
      first.decisions.map(({ candidate, replacementTaskId }) => ({
        failedTaskId: candidate.failedTaskId,
        originalTaskId: candidate.originalTaskId,
        remainingReplacements: candidate.remainingReplacements,
        replacementTaskId,
      })),
    ).toEqual([
      {
        failedTaskId: initial.id,
        originalTaskId: initial.id,
        remainingReplacements: 1,
        replacementTaskId: '00000000-0000-4000-8000-000000000002',
      },
      {
        failedTaskId: '00000000-0000-4000-8000-000000000002',
        originalTaskId: initial.id,
        remainingReplacements: 0,
        replacementTaskId: '00000000-0000-4000-8000-000000000003',
      },
    ]);
    expect(first.cumulativeUsage).toEqual({
      inputTokens: 16,
      outputTokens: 32,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: 0,
    });
    expect(ctx.checkpointNames).toEqual([
      'extract.2.recovery.1.decision',
      'extract.2.recovery.1.create',
      'extract.2.recovery.2.decision',
      'extract.2.recovery.2.create',
    ]);
    expect(gate).toHaveBeenCalledTimes(2);
    expect(tasks.created).toHaveLength(3);
  });

  it.each(['deny', 'abstain'] as const)(
    'blocks %s without creating a task',
    async (verdict) => {
      const tasks = new FakeTasks([{ __taskStatus: 'failed' }]);
      const initial = await tasks.createTask(body);
      const result = await waitForRecoverableTask(
        initial,
        setup(tasks, {
          recoveryGate: {
            identity: { name: 'test-rule', version: '1' },
            decide: () => Promise.resolve({ verdict, reasonCode: 'policy' }),
          },
        }),
      );
      expect(result).toMatchObject({
        kind: 'blocked',
        decision: { verdict, reasonCode: 'policy' },
      });
      expect(tasks.created).toHaveLength(1);
    },
  );

  it.each([
    {
      name: 'malformed',
      decide: () =>
        Promise.resolve({
          verdict: 'maybe',
          reasonCode: 'x',
          payload: 'SECRET gate output',
        }),
      reasonCode: 'gate_invalid',
    },
    {
      name: 'error',
      decide: () => Promise.reject(new Error('offline')),
      reasonCode: 'gate_error',
    },
    {
      name: 'timeout',
      decide: () => new Promise<never>(() => {}),
      reasonCode: 'gate_timeout',
    },
  ])('fails closed on $name gate result', async ({ decide, reasonCode }) => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }]);
    const initial = await tasks.createTask(body);
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } satisfies Logger;
    const result = await waitForRecoverableTask(
      initial,
      setup(tasks, {
        recoveryGate: { identity: { name: 'test-rule', version: '1' }, decide },
        gateTimeoutMs: 5,
        logger,
      }),
    );
    expect(result).toMatchObject({
      kind: 'blocked',
      decision: { verdict: 'invalid', reasonCode },
    });
    expect(tasks.created).toHaveLength(1);
    if (reasonCode === 'gate_error') {
      expect(logger.error.mock.calls.at(-1)?.[0]).toMatchObject({
        diagnostic: { category: 'unknown' },
        gateIdentity: { name: 'test-rule', version: '1' },
        failedTaskId: initial.id,
      });
      expect(logger.error.mock.calls.at(-1)?.[1]).toBe(
        'orchestration.recovery.gate.error',
      );
      expect(JSON.stringify(logger.error.mock.calls.at(-1)?.[0])).not.toContain(
        'offline',
      );
    }
    if (reasonCode === 'gate_invalid') {
      expect(logger.warn.mock.calls.at(-1)?.[0]).toMatchObject({
        gateIdentity: { name: 'test-rule', version: '1' },
        failedTaskId: initial.id,
        replacementN: 1,
        reasonCode: 'gate_invalid',
      });
      expect(logger.warn.mock.calls.at(-1)?.[1]).toBe(
        'orchestration.recovery.gate.invalid',
      );
      expect(JSON.stringify(logger.warn.mock.calls.at(-1)?.[0])).not.toContain(
        'SECRET',
      );
    }
  });

  it('does not ask the gate after the independent replacement budget is spent', async () => {
    const tasks = new FakeTasks([
      { __taskStatus: 'failed' },
      { __taskStatus: 'failed' },
    ]);
    const initial = await tasks.createTask(body);
    const gate = vi.fn(() =>
      Promise.resolve({ verdict: 'approve' as const, reasonCode: 'retryable' }),
    );
    const result = await waitForRecoverableTask(
      initial,
      setup(tasks, {
        recoveryGate: {
          identity: { name: 'test-rule', version: '1' },
          decide: gate,
        },
      }),
    );
    expect(result).toMatchObject({
      kind: 'failed',
      reasonCode: 'budget_exhausted',
    });
    expect(result.chain).toHaveLength(2);
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('retains failed attempts and sums usage across both task identities', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, { done: true }]);
    const initial = await tasks.createTask(body);
    const listAttempts = tasks.listAttempts.bind(tasks);
    tasks.listAttempts = async (id) =>
      (await listAttempts(id)).map((attempt) => ({
        ...attempt,
        usage:
          id === initial.id
            ? {
                inputTokens: 5,
                outputTokens: 2,
                cacheReadTokens: 3,
                model: 'failed-model',
              }
            : {
                inputTokens: 7,
                outputTokens: 4,
                toolCalls: 1,
                model: 'success-model',
              },
      }));

    const result = await waitForRecoverableTask(initial, setup(tasks));

    expect(result.kind).toBe('accepted');
    expect(result.cumulativeUsage).toEqual({
      inputTokens: 12,
      outputTokens: 6,
      cacheReadTokens: 3,
      cacheWriteTokens: 0,
      toolCalls: 1,
    });
    expect(
      result.chain[0]?.outcome.kind === 'failed'
        ? result.chain[0].outcome.attempts[0]?.usage?.model
        : null,
    ).toBe('failed-model');
  });

  it('does not restart cancellation by default', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'cancelled' }]);
    const initial = await tasks.createTask(body);
    const gate = vi.fn();
    const result = await waitForRecoverableTask(
      initial,
      setup(tasks, {
        recoveryGate: {
          identity: { name: 'test-rule', version: '1' },
          decide: gate,
        },
      }),
    );
    expect(result).toMatchObject({ kind: 'failed', reasonCode: 'cancelled' });
    expect(gate).not.toHaveBeenCalled();
  });

  it('can recover cancellation only when the caller opts in', async () => {
    const tasks = new FakeTasks([
      { __taskStatus: 'cancelled' },
      { done: true },
    ]);
    const initial = await tasks.createTask(body);
    const result = await waitForRecoverableTask(
      initial,
      setup(tasks, {
        recoverCancelled: true,
      }),
    );
    expect(result.kind).toBe('accepted');
    expect(tasks.created).toHaveLength(2);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid replacement budget %s before awaiting',
    async (maxReplacements) => {
      const tasks = new FakeTasks([{ __taskStatus: 'failed' }]);
      const initial = await tasks.createTask(body);
      const getTask = vi.spyOn(tasks, 'getTask');
      await expect(
        waitForRecoverableTask(initial, setup(tasks, { maxReplacements })),
      ).rejects.toThrow('maxReplacements must be a non-negative safe integer');
      expect(getTask).not.toHaveBeenCalled();
    },
  );

  it('returns an inspectable create error without starting another task', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }]);
    const initial = await tasks.createTask(body);
    const error = Object.assign(new Error('SECRET request context'), {
      response: { status: 403, body: 'SECRET response body' },
    });
    tasks.createTask = vi.fn().mockRejectedValue(error);
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } satisfies Logger;
    const result = await waitForRecoverableTask(
      initial,
      setup(tasks, { logger }),
    );
    expect(result).toMatchObject({
      kind: 'replacement_create_failed',
      reasonCode: 'replacement_create_error',
    });
    expect(logger.error.mock.calls.at(-1)?.[0]).toMatchObject({
      diagnostic: { category: 'authorization', statusCode: 403 },
    });
    expect(logger.error.mock.calls.at(-1)?.[1]).toBe(
      'orchestration.recovery.create.error',
    );
    expect(JSON.stringify(logger.error.mock.calls.at(-1)?.[0])).not.toContain(
      'SECRET',
    );
  });

  it('records an already-created replacement and its mismatched fields', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, { done: true }]);
    const initial = await tasks.createTask(body);
    const realCreate = tasks.createTask.bind(tasks);
    tasks.createTask = async (request, options) => ({
      ...(await realCreate(request, options)),
      title: 'unexpected title',
    });
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } satisfies Logger;

    const result = await waitForRecoverableTask(
      initial,
      setup(tasks, { logger }),
    );

    expect(result).toMatchObject({
      kind: 'replacement_create_failed',
      reasonCode: 'replacement_identity_mismatch',
      replacementTaskId: '00000000-0000-4000-8000-000000000002',
      mismatchedFields: ['title'],
      decisions: [
        { replacementTaskId: '00000000-0000-4000-8000-000000000002' },
      ],
    });
    expect(logger.error.mock.calls.at(-1)?.[0]).toMatchObject({
      replacementTaskId: '00000000-0000-4000-8000-000000000002',
      mismatchedFields: ['title'],
    });
  });

  it('fails closed when a gate tries to change its candidate', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }]);
    const initial = await tasks.createTask(body);
    const gate = {
      identity: { name: 'mutating-rule', version: '1' },
      decide: (input: RecoveryGateInput) => {
        (input.candidate as { replacementN: number }).replacementN = 99;
        return Promise.resolve({
          verdict: 'approve' as const,
          reasonCode: 'attempted_change',
        });
      },
    };
    const result = await waitForRecoverableTask(
      initial,
      setup(tasks, { recoveryGate: gate }),
    );
    expect(result).toMatchObject({
      kind: 'blocked',
      decision: { verdict: 'invalid', reasonCode: 'gate_error' },
    });
    expect(tasks.created).toHaveLength(1);
  });

  it('creates from the original request if a gate mutates the caller-owned object', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, { done: true }]);
    const request = structuredClone(body);
    const initial = await tasks.createTask(request);
    const gate = {
      identity: { name: 'mutating-rule', version: '1' },
      decide: () => {
        request.input = { brief: 'changed after the gate started' };
        return Promise.resolve({
          verdict: 'approve' as const,
          reasonCode: 'approved',
        });
      },
    };
    const result = await waitForRecoverableTask(
      initial,
      setup(tasks, {
        frozenRequest: request,
        recoveryGate: gate,
      }),
    );
    expect(result.kind).toBe('accepted');
    expect(tasks.created[1]?.input).toEqual(body.input);
  });

  it('reuses a checkpointed gate decision when creation fails then workflow replays', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, { done: true }]);
    const initial = await tasks.createTask(body);
    const realCreate = tasks.createTask.bind(tasks);
    let fail = true;
    tasks.createTask = vi.fn(
      (
        request: Parameters<TaskClient['createTask']>[0],
        options?: Parameters<TaskClient['createTask']>[1],
      ) => {
        if (fail) return Promise.reject(new Error('temporary create failure'));
        return realCreate(request, options);
      },
    );
    const ctx = replayContext('decision-replay');
    const gate = vi.fn(() =>
      Promise.resolve({ verdict: 'approve' as const, reasonCode: 'retryable' }),
    );
    const options = setup(tasks, {
      ctx,
      recoveryGate: {
        identity: { name: 'test-rule', version: '1' },
        decide: gate,
      },
    });

    const first = await waitForRecoverableTask(initial, options);
    fail = false;
    ctx.resetForReplay();
    const second = await waitForRecoverableTask(initial, options);

    expect(first.kind).toBe('replacement_create_failed');
    expect(second.kind).toBe('accepted');
    expect(gate).toHaveBeenCalledTimes(1);
    expect(tasks.created).toHaveLength(2);
  });

  it('reconciles a create that succeeded before checkpoint completion', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, { done: true }]);
    const initial = await tasks.createTask(body);
    const realCreate = tasks.createTask.bind(tasks);
    const byKey = new Map<
      string,
      Awaited<ReturnType<TaskClient['createTask']>>
    >();
    const createMock = vi.fn(
      async (
        request: Parameters<TaskClient['createTask']>[0],
        options?: Parameters<TaskClient['createTask']>[1],
      ) => {
        const key = options?.idempotencyKey;
        if (!key) throw new Error('missing idempotency key');
        const existing = byKey.get(key);
        if (existing) return existing;
        const created = await realCreate(request, options);
        byKey.set(key, created);
        return created;
      },
    );
    tasks.createTask = createMock;
    const ctx = replayContext('create-gap');
    const complete = ctx.completeStep.bind(ctx);
    let crash = true;
    ctx.completeStep = (handle, value) => {
      if (handle.name.endsWith('.create') && crash) {
        crash = false;
        throw new Error('worker stopped after external create');
      }
      return complete(handle, value);
    };
    const gate = vi.fn(() =>
      Promise.resolve({ verdict: 'approve' as const, reasonCode: 'retryable' }),
    );
    const options = setup(tasks, {
      ctx,
      recoveryGate: {
        identity: { name: 'test-rule', version: '1' },
        decide: gate,
      },
    });

    const first = await waitForRecoverableTask(initial, options);
    ctx.resetForReplay();
    const second = await waitForRecoverableTask(initial, options);

    expect(first.kind).toBe('replacement_create_failed');
    expect(second.kind).toBe('accepted');
    expect(gate).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(tasks.created).toHaveLength(2);
    expect(byKey.size).toBe(1);
  });

  it('replaces a failed semantic repair without changing its completed parent or feedback', async () => {
    const repairBody = {
      ...body,
      input: {
        continueFrom: {
          taskId: 'completed-source',
          attemptN: 2,
          mode: 'extend',
        },
        feedback: 'missing required phase',
      },
    };
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, { done: true }]);
    const failedRepair = await tasks.createTask(repairBody);
    const gate = vi.fn((_input: RecoveryGateInput) =>
      Promise.resolve({ verdict: 'approve' as const, reasonCode: 'retryable' }),
    );

    const result = await waitForRecoverableTask(
      failedRepair,
      setup(tasks, {
        frozenRequest: repairBody,
        parentTaskId: 'completed-source',
        recoveryGate: {
          identity: { name: 'test-rule', version: '1' },
          decide: gate,
        },
      }),
    );

    expect(result.kind).toBe('accepted');
    expect(gate.mock.calls[0]?.[0].candidate.parentTaskId).toBe(
      'completed-source',
    );
    expect(tasks.created[1]?.input).toEqual(repairBody.input);
  });

  it('rejects an initial task whose frozen request has changed', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }]);
    const initial = await tasks.createTask(body);
    const gate = vi.fn();
    await expect(
      waitForRecoverableTask(
        initial,
        setup(tasks, {
          frozenRequest: { ...body, input: { brief: 'changed' } },
          recoveryGate: {
            identity: { name: 'test-rule', version: '1' },
            decide: gate,
          },
        }),
      ),
    ).rejects.toThrow('frozenRequest does not match');
    expect(gate).not.toHaveBeenCalled();
  });

  it('rejects a changed relative lifetime and accepts the original lifetime', async () => {
    const expiringBody = { ...body, expiresInSec: 60 };
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, { done: true }]);
    const initial = await tasks.createTask(expiringBody);
    await expect(
      waitForRecoverableTask(
        initial,
        setup(tasks, {
          frozenRequest: { ...expiringBody, expiresInSec: 120 },
        }),
      ),
    ).rejects.toThrow('frozenRequest does not match');

    const result = await waitForRecoverableTask(
      initial,
      setup(tasks, {
        frozenRequest: expiringBody,
      }),
    );
    expect(result.kind).toBe('accepted');
    expect(tasks.created[1]?.expiresInSec).toBe(60);
  });

  it('preserves the initial effective lifetime when the caller omits it', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, { done: true }]);
    const initial = await tasks.createTask({ ...body, expiresInSec: 60 });

    const result = await waitForRecoverableTask(initial, setup(tasks));

    expect(result.kind).toBe('accepted');
    expect(tasks.created[1]?.expiresInSec).toBe(60);
  });

  it('records a replacement whose returned lifetime differs', async () => {
    const expiringBody = { ...body, expiresInSec: 60 };
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, { done: true }]);
    const initial = await tasks.createTask(expiringBody);
    const realCreate = tasks.createTask.bind(tasks);
    tasks.createTask = async (request, options) => {
      const created = await realCreate(request, options);
      return {
        ...created,
        expiresAt: new Date(
          Date.parse(created.expiresAt ?? '') + 60_000,
        ).toISOString(),
      };
    };

    const result = await waitForRecoverableTask(
      initial,
      setup(tasks, {
        frozenRequest: expiringBody,
      }),
    );

    expect(result).toMatchObject({
      kind: 'replacement_create_failed',
      replacementTaskId: '00000000-0000-4000-8000-000000000002',
      mismatchedFields: ['expiresInSec'],
    });
  });

  it.each([
    { title: 'changed' },
    { tags: ['different'] },
    { dispatchTimeoutSec: 30 },
    { runningTimeoutSec: 60 },
  ])('rejects changed frozen request metadata %o', async (change) => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }]);
    const initial = await tasks.createTask(body);
    await expect(
      waitForRecoverableTask(
        initial,
        setup(tasks, { frozenRequest: { ...body, ...change } }),
      ),
    ).rejects.toThrow('frozenRequest does not match');
  });

  it('rejects a replayed decision under a different gate version', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }]);
    const initial = await tasks.createTask(body);
    const ctx = replayContext('gate-version-change');
    const first = await waitForRecoverableTask(
      initial,
      setup(tasks, {
        ctx,
        recoveryGate: {
          identity: { name: 'test-rule', version: '1' },
          decide: () =>
            Promise.resolve({ verdict: 'deny', reasonCode: 'policy' }),
        },
      }),
    );
    expect(first.kind).toBe('blocked');
    ctx.resetForReplay();
    const newGate = vi.fn();
    await expect(
      waitForRecoverableTask(
        initial,
        setup(tasks, {
          ctx,
          recoveryGate: {
            identity: { name: 'test-rule', version: '2' },
            decide: newGate,
          },
        }),
      ),
    ).rejects.toThrow('gate identity');
    expect(newGate).not.toHaveBeenCalled();
    expect(tasks.created).toHaveLength(1);
  });
});
