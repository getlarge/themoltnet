import type { Task, TaskOutput } from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';
import { MoltNetError } from '@themoltnet/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDaemonStateForComplete,
  finalizeTask,
  type WriteCorrelationAnchors,
} from './finalize.js';

interface CompleteBody {
  output: Record<string, unknown>;
  outputCid: string;
  contentSignature?: string;
}

interface FailBody {
  error: NonNullable<TaskOutput['error']>;
}

function makeOutput(
  status: TaskOutput['status'],
  output: Record<string, unknown> | null,
): TaskOutput {
  return {
    taskId: 't1',
    attemptN: 1,
    status,
    output,
    outputCid: output ? 'bafy-out' : null,
    usage: { inputTokens: 0, outputTokens: 0 },
    durationMs: 100,
  };
}

type CompleteMock = (
  taskId: string,
  attemptN: number,
  body: CompleteBody,
) => Promise<void>;
type FailMock = (
  taskId: string,
  attemptN: number,
  body: FailBody,
) => Promise<void>;
type HeartbeatMock = (
  taskId: string,
  attemptN: number,
  body: Record<string, never>,
) => Promise<{
  claimExpiresAt: string;
  cancelled: boolean;
  cancelReason: string | null;
}>;

function makeAgent() {
  const complete = vi.fn<CompleteMock>().mockResolvedValue(undefined);
  const failAttempt = vi.fn<FailMock>().mockResolvedValue(undefined);
  const heartbeat = vi.fn<HeartbeatMock>().mockResolvedValue({
    claimExpiresAt: new Date(0).toISOString(),
    cancelled: false,
    cancelReason: null,
  });
  const listMessages = vi.fn().mockResolvedValue([]);
  return {
    complete,
    failAttempt,
    heartbeat,
    listMessages,
    agent: {
      tasks: { complete, failAttempt, heartbeat, listMessages },
    } as unknown as Agent,
  };
}

describe('finalizeTask', () => {
  let stub: ReturnType<typeof makeAgent>;

  beforeEach(() => {
    stub = makeAgent();
  });

  it('passes the LLM output through unchanged on /complete', async () => {
    // The LLM is the sole author of any `verification` block; the daemon
    // does not evaluate input.successCriteria. If the LLM put a
    // verification block inside its output, it travels to the server
    // verbatim — the daemon does not inspect it.
    const output = makeOutput('completed', {
      branch: 'feat/x',
      verification: {
        inputCid: 'bafy-input',
        results: [{ id: 'has-pr', kind: 'assertion', status: 'fail' }],
        passed: false,
      },
    });
    await finalizeTask(stub.agent, output);

    expect(stub.complete).toHaveBeenCalledTimes(1);
    const body = stub.complete.mock.calls[0][2];
    expect(body.output).toEqual(output.output);
    expect(body.outputCid).toBe('bafy-out');
  });

  it('omits verification when the LLM did not include one', async () => {
    const output = makeOutput('completed', { branch: 'feat/x' });
    await finalizeTask(stub.agent, output);

    expect(stub.complete).toHaveBeenCalledTimes(1);
    const body = stub.complete.mock.calls[0][2];
    expect(body.output).toEqual({ branch: 'feat/x' });
  });

  it('forwards contentSignature when present', async () => {
    const output = makeOutput('completed', { branch: 'feat/x' });
    output.contentSignature = 'sig-abc';
    await finalizeTask(stub.agent, output);

    expect(stub.complete).toHaveBeenCalledTimes(1);
    expect(stub.complete.mock.calls[0][2].contentSignature).toBe('sig-abc');
  });

  it('calls /failAttempt with the executor-provided error', async () => {
    const failed = makeOutput('failed', null);
    failed.error = { code: 'oops', message: 'broke' };
    await finalizeTask(stub.agent, failed);

    expect(stub.heartbeat).toHaveBeenCalledWith('t1', 1, {});
    expect(stub.failAttempt).toHaveBeenCalledTimes(1);
    const error = stub.failAttempt.mock.calls[0][2].error;
    expect(error.code).toBe('oops');
  });

  it('uses retry triage for ambiguous failed outputs', async () => {
    const failed = makeOutput('failed', null);
    failed.error = { code: 'executor_unexpected_error', message: 'unclear' };
    const task = {
      id: 't1',
      taskType: 'freeform',
      teamId: 'team-1',
      input: { brief: 'do it' },
      maxAttempts: 2,
    } as unknown as Task;

    await finalizeTask(stub.agent, failed, {
      task,
      retryTriage: () =>
        Promise.resolve({
          decision: 'retry',
          confidence: 'high',
          reason: 'Runtime-local crash after recoverable work.',
        }),
    });

    const error = stub.failAttempt.mock.calls[0][2].error;
    expect(error.retryable).toBe(true);
    expect(error.retry).toEqual({
      source: 'triage',
      decision: 'retry',
      confidence: 'high',
      reason: 'Runtime-local crash after recoverable work.',
    });
    expect(error.message).toContain('Retry triage: retry/high');
  });

  it('does not retry low-confidence triage', async () => {
    const failed = makeOutput('failed', null);
    failed.error = { code: 'executor_unexpected_error', message: 'unclear' };
    const task = {
      id: 't1',
      taskType: 'freeform',
      teamId: 'team-1',
      input: { brief: 'do it' },
      maxAttempts: 2,
    } as unknown as Task;

    await finalizeTask(stub.agent, failed, {
      task,
      retryTriage: () =>
        Promise.resolve({
          decision: 'retry',
          confidence: 'low',
          reason: 'Weak signal.',
        }),
    });

    expect(stub.failAttempt.mock.calls[0][2].error.retryable).toBe(false);
    expect(stub.failAttempt.mock.calls[0][2].error.retry).toEqual({
      source: 'triage',
      decision: 'retry',
      confidence: 'low',
      reason: 'Weak signal.',
    });
  });

  it('classifies transient completion reporting failures as retryable attempt failures', async () => {
    const output = makeOutput('completed', { branch: 'feat/x' });
    const task = {
      id: 't1',
      taskType: 'freeform',
      teamId: 'team-1',
      input: { brief: 'do it' },
      maxAttempts: 2,
    } as unknown as Task;
    stub.complete.mockRejectedValueOnce(new Error('ECONNRESET'));

    await finalizeTask(stub.agent, output, { task });

    expect(stub.failAttempt).toHaveBeenCalledTimes(1);
    const error = stub.failAttempt.mock.calls[0][2].error;
    expect(error).toMatchObject({
      code: 'complete_call_failed',
      retryable: true,
      retry: {
        source: 'deterministic',
        decision: 'retry',
        confidence: 'high',
      },
    });
  });

  it('keeps server output validation rejections non-retryable', async () => {
    const output = makeOutput('completed', { branch: 'feat/x' });
    stub.complete.mockRejectedValueOnce(
      new MoltNetError('Validation failed', {
        code: 'VALIDATION_FAILED',
        statusCode: 400,
        detail: 'output.verification is required',
        validationErrors: [
          {
            field: 'output.verification',
            message: 'is required because successCriteria is set',
          },
        ],
      }),
    );

    await finalizeTask(stub.agent, output);

    const error = stub.failAttempt.mock.calls[0][2].error;
    expect(error).toMatchObject({
      code: 'output_rejected_by_server',
      retryable: false,
      retry: {
        source: 'explicit',
        decision: 'do_not_retry',
        confidence: 'high',
      },
    });
    expect(error.message).toContain('output.verification');
  });

  it('does not call /failAttempt when the startup heartbeat observes cancellation', async () => {
    stub.heartbeat.mockResolvedValueOnce({
      claimExpiresAt: new Date(0).toISOString(),
      cancelled: true,
      cancelReason: 'cancelled before fail landed',
    });
    await finalizeTask(stub.agent, makeOutput('failed', null));

    expect(stub.heartbeat).toHaveBeenCalledWith('t1', 1, {});
    expect(stub.failAttempt).not.toHaveBeenCalled();
  });

  it('is a no-op for cancelled outputs', async () => {
    await finalizeTask(stub.agent, makeOutput('cancelled', null));
    expect(stub.heartbeat).not.toHaveBeenCalled();
    expect(stub.failAttempt).not.toHaveBeenCalled();
    expect(stub.complete).not.toHaveBeenCalled();
  });
});

const FULFILL_TASK = {
  id: '11111111-2222-4333-8444-555555555550',
  taskType: 'fulfill_brief',
  correlationId: '11111111-2222-4333-8444-555555555555',
} as unknown as Task;

const COMPLETED_BASE = {
  taskId: '11111111-2222-4333-8444-555555555550',
  attemptN: 1,
  status: 'completed' as const,
  outputCid: 'cid:abc',
  usage: { inputTokens: 0, outputTokens: 0 },
  durationMs: 0,
};

describe('finalizeTask — fulfill_brief correlation hook', () => {
  it('invokes the writer when output is completed and PR url present', async () => {
    const writer = vi
      .fn<WriteCorrelationAnchors>()
      .mockResolvedValue(undefined);
    const m = makeAgent();
    const output: TaskOutput = {
      ...COMPLETED_BASE,
      output: {
        branch: 'moltnet/11111111-2222-4333-8444-555555555555/x',
        commits: [],
        pullRequestUrl: 'https://github.com/o/r/pull/3',
        diaryEntryIds: [],
        summary: 's',
      },
    };

    await finalizeTask(m.agent, output, {
      task: FULFILL_TASK,
      writeCorrelationAnchors: writer,
    });

    expect(writer).toHaveBeenCalledWith({
      correlationId: '11111111-2222-4333-8444-555555555555',
      pullRequestUrl: 'https://github.com/o/r/pull/3',
    });
    expect(m.complete).toHaveBeenCalled();
  });

  it('skips the writer when task is not fulfill_brief', async () => {
    const writer = vi
      .fn<WriteCorrelationAnchors>()
      .mockResolvedValue(undefined);
    const m = makeAgent();
    const assessTask = { ...FULFILL_TASK, taskType: 'assess_brief' } as Task;

    await finalizeTask(
      m.agent,
      {
        ...COMPLETED_BASE,
        output: { scores: [] },
      },
      { task: assessTask, writeCorrelationAnchors: writer },
    );
    expect(writer).not.toHaveBeenCalled();
  });

  it('skips the writer when correlationId is null', async () => {
    const writer = vi
      .fn<WriteCorrelationAnchors>()
      .mockResolvedValue(undefined);
    const m = makeAgent();
    const noCorr = { ...FULFILL_TASK, correlationId: null } as Task;

    await finalizeTask(
      m.agent,
      {
        ...COMPLETED_BASE,
        output: { pullRequestUrl: 'https://github.com/o/r/pull/3' },
      },
      { task: noCorr, writeCorrelationAnchors: writer },
    );
    expect(writer).not.toHaveBeenCalled();
  });

  it('skips the writer when output has no pullRequestUrl', async () => {
    const writer = vi
      .fn<WriteCorrelationAnchors>()
      .mockResolvedValue(undefined);
    const m = makeAgent();

    await finalizeTask(
      m.agent,
      {
        ...COMPLETED_BASE,
        output: { pullRequestUrl: null },
      },
      { task: FULFILL_TASK, writeCorrelationAnchors: writer },
    );
    expect(writer).not.toHaveBeenCalled();
  });

  it('logs but does not throw when the writer fails', async () => {
    const writer = vi
      .fn<WriteCorrelationAnchors>()
      .mockRejectedValue(new Error('gh down'));
    const m = makeAgent();
    const log = vi.fn();

    await expect(
      finalizeTask(
        m.agent,
        {
          ...COMPLETED_BASE,
          output: { pullRequestUrl: 'https://x/y/pull/1' },
        },
        { task: FULFILL_TASK, writeCorrelationAnchors: writer, log },
      ),
    ).resolves.toBeUndefined();

    expect(m.complete).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'correlation-anchor-write-failed',
      expect.any(Error),
    );
  });

  it('cancelled output short-circuits before complete/fail/writer', async () => {
    const writer = vi
      .fn<WriteCorrelationAnchors>()
      .mockResolvedValue(undefined);
    const m = makeAgent();

    await finalizeTask(
      m.agent,
      {
        ...COMPLETED_BASE,
        status: 'cancelled' as const,
        output: null,
        outputCid: null,
      },
      { task: FULFILL_TASK, writeCorrelationAnchors: writer },
    );
    expect(m.complete).not.toHaveBeenCalled();
    expect(m.failAttempt).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
  });
});

describe('buildDaemonStateForComplete', () => {
  it('returns null for non-freeform task types', () => {
    expect(buildDaemonStateForComplete('fulfill_brief', null)).toBeNull();
    expect(
      buildDaemonStateForComplete('fulfill_brief', { expiresAtMs: 12345 }),
    ).toBeNull();
    expect(buildDaemonStateForComplete('discovery', null)).toBeNull();
  });

  it('reports null slotResumableUntil for freeform without a slot', () => {
    const state = buildDaemonStateForComplete('freeform', null);
    expect(state).not.toBeNull();
    expect(state?.slotResumableUntil).toBeNull();
    // reportedAt must be a parseable ISO timestamp
    expect(typeof state?.reportedAt).toBe('string');
    expect(Number.isNaN(Date.parse(state!.reportedAt))).toBe(false);
  });

  it('reports null slotResumableUntil for freeform when expiresAtMs is falsy', () => {
    const state = buildDaemonStateForComplete('freeform', { expiresAtMs: 0 });
    expect(state?.slotResumableUntil).toBeNull();
  });

  it('reports ISO slotResumableUntil for freeform with a slot expiry', () => {
    const expiresAtMs = Date.UTC(2026, 0, 1, 12, 0, 0);
    const state = buildDaemonStateForComplete('freeform', { expiresAtMs });
    expect(state).not.toBeNull();
    expect(state?.slotResumableUntil).toBe(new Date(expiresAtMs).toISOString());
    expect(Number.isNaN(Date.parse(state!.reportedAt))).toBe(false);
  });
});
