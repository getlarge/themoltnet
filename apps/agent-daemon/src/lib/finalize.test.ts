import type {
  Task,
  TaskOutput,
  VerificationRecord,
  VerificationResult,
} from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { finalizeTask } from './finalize.js';

interface CompleteBody {
  output: Record<string, unknown>;
  outputCid: string;
  verification?: VerificationRecord;
}

interface FailBody {
  error: { code: string; message: string; retryable?: boolean };
}

function makeTask(input: Record<string, unknown>): Task {
  return {
    id: 't1',
    taskType: 'fulfill_brief',
    teamId: '11111111-1111-4111-8111-111111111111',
    diaryId: null,
    outputKind: 'artifact',
    input,
    inputSchemaCid: 'bafy-schema',
    inputCid: 'bafy-input',
    references: [],
    correlationId: null,
    imposedByAgentId: null,
    imposedByHumanId: null,
    acceptedAttemptN: null,
    requiredExecutorTrustLevel: 'selfDeclared',
    status: 'running',
    queuedAt: '2026-05-07T00:00:00.000Z',
    completedAt: null,
    expiresAt: null,
    cancelledByAgentId: null,
    cancelledByHumanId: null,
    cancelReason: null,
    maxAttempts: 1,
    dispatchTimeoutSec: null,
    runningTimeoutSec: null,
  } as unknown as Task;
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

function makeAgent() {
  const complete = vi.fn<CompleteMock>().mockResolvedValue(undefined);
  const fail = vi.fn<FailMock>().mockResolvedValue(undefined);
  return {
    complete,
    fail,
    agent: { tasks: { complete, fail } } as unknown as Agent,
  };
}

describe('finalizeTask', () => {
  let stub: ReturnType<typeof makeAgent>;

  beforeEach(() => {
    stub = makeAgent();
  });

  it('calls /complete with no verification when input has no successCriteria', async () => {
    const task = makeTask({ brief: 'do the thing' });
    const output = makeOutput('completed', { branch: 'feat/x' });
    await finalizeTask(stub.agent, { task, attemptN: 1 }, output);

    expect(stub.complete).toHaveBeenCalledTimes(1);
    expect(stub.fail).not.toHaveBeenCalled();
    expect(stub.complete.mock.calls[0][2].verification).toBeUndefined();
  });

  it('attaches verification.passed=true when all assertions pass', async () => {
    const task = makeTask({
      brief: 'do',
      successCriteria: {
        version: 1,
        assertions: [
          { id: 'has-branch', path: 'branch', op: 'exists' },
          {
            id: 'branch-prefix',
            path: 'branch',
            op: 'matches',
            value: '^feat/',
          },
        ],
      },
    });
    const output = makeOutput('completed', { branch: 'feat/x' });
    await finalizeTask(stub.agent, { task, attemptN: 1 }, output);

    expect(stub.complete).toHaveBeenCalledTimes(1);
    const verification = stub.complete.mock.calls[0][2].verification!;
    expect(verification).toMatchObject({
      inputCid: 'bafy-input',
      passed: true,
    });
    expect(verification.results).toHaveLength(2);
    expect(verification.results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('hard-fails the attempt when a required assertion fails', async () => {
    const task = makeTask({
      brief: 'do',
      successCriteria: {
        version: 1,
        assertions: [{ id: 'has-pr', path: 'pullRequestUrl', op: 'exists' }],
      },
    });
    const output = makeOutput('completed', { branch: 'feat/x' });
    await finalizeTask(stub.agent, { task, attemptN: 1 }, output);

    expect(stub.complete).not.toHaveBeenCalled();
    expect(stub.fail).toHaveBeenCalledTimes(1);
    const error = stub.fail.mock.calls[0][2].error;
    expect(error.code).toBe('criteria_unmet');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('has-pr');
  });

  it('reports gate/rubric/sideEffect criteria as informational skips', async () => {
    const task = makeTask({
      brief: 'do',
      successCriteria: {
        version: 1,
        gates: [
          {
            id: 'shape',
            kind: 'schema-check',
            spec: { schemaCid: 'bafy-schema' },
            required: true,
          },
        ],
        rubric: {
          rubricId: 'r',
          version: 'v1',
          criteria: [
            { id: 'c', description: 'd', weight: 1, scoring: 'llm_score' },
          ],
        },
        minComposite: 0.5,
        sideEffects: { diaryEntryRequired: true },
        assertions: [{ id: 'ok', path: 'branch', op: 'exists' }],
      },
    });
    const output = makeOutput('completed', { branch: 'feat/x' });
    await finalizeTask(stub.agent, { task, attemptN: 1 }, output);

    // Assertions pass, the rest are skipped (Stage 3 v1) — overall pass.
    expect(stub.complete).toHaveBeenCalledTimes(1);
    expect(stub.fail).not.toHaveBeenCalled();
    const verification = stub.complete.mock.calls[0][2].verification!;
    const skipped = verification.results.filter(
      (r: VerificationResult) => r.status === 'skip',
    );
    expect(skipped.map((r) => r.id).sort()).toEqual([
      'rubric-composite',
      'shape',
      'sideEffect-diaryEntryRequired',
    ]);
    expect(verification.passed).toBe(true);
  });

  it('passes through failed and cancelled outputs unchanged', async () => {
    const task = makeTask({ brief: 'do' });
    const failed = makeOutput('failed', null);
    failed.error = { code: 'oops', message: 'broke' };
    await finalizeTask(stub.agent, { task, attemptN: 1 }, failed);
    expect(stub.fail).toHaveBeenCalledTimes(1);
    const error = stub.fail.mock.calls[0][2].error;
    expect(error.code).toBe('oops');

    stub.fail.mockClear();
    stub.complete.mockClear();
    await finalizeTask(
      stub.agent,
      { task, attemptN: 1 },
      makeOutput('cancelled', null),
    );
    expect(stub.fail).not.toHaveBeenCalled();
    expect(stub.complete).not.toHaveBeenCalled();
  });
});
