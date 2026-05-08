import type { TaskOutput } from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { finalizeTask } from './finalize.js';

interface CompleteBody {
  output: Record<string, unknown>;
  outputCid: string;
  contentSignature?: string;
}

interface FailBody {
  error: { code: string; message: string; retryable?: boolean };
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
    expect(stub.fail).not.toHaveBeenCalled();
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

  it('calls /fail with the executor-provided error', async () => {
    const failed = makeOutput('failed', null);
    failed.error = { code: 'oops', message: 'broke' };
    await finalizeTask(stub.agent, failed);

    expect(stub.fail).toHaveBeenCalledTimes(1);
    const error = stub.fail.mock.calls[0][2].error;
    expect(error.code).toBe('oops');
  });

  it('is a no-op for cancelled outputs', async () => {
    await finalizeTask(stub.agent, makeOutput('cancelled', null));
    expect(stub.fail).not.toHaveBeenCalled();
    expect(stub.complete).not.toHaveBeenCalled();
  });
});
