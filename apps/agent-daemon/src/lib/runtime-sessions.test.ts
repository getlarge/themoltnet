import type { TaskOutput } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { applyRuntimeSessionUploadFailure } from './runtime-sessions.js';

function makeOutput(status: TaskOutput['status']): TaskOutput {
  return {
    taskId: 'task-1',
    attemptN: 1,
    status,
    output: status === 'completed' ? { ok: true } : null,
    outputCid: status === 'completed' ? 'bafy-output' : null,
    usage: { inputTokens: 1, outputTokens: 2 },
    durationMs: 100,
  };
}

describe('runtime session finalization helpers', () => {
  it('turns a completed output into a retryable failure when checkpoint upload fails', () => {
    const output = makeOutput('completed');

    const result = applyRuntimeSessionUploadFailure(
      output,
      new Error('object storage unavailable'),
    );

    expect(result).toMatchObject({
      taskId: output.taskId,
      attemptN: output.attemptN,
      status: 'failed',
      output: null,
      outputCid: null,
      error: {
        code: 'runtime_session_upload_failed',
        retryable: true,
      },
    });
    expect(result.error?.message).toContain('object storage unavailable');
  });

  it('preserves an already failed output when checkpoint upload also fails', () => {
    const output = {
      ...makeOutput('failed'),
      error: {
        code: 'executor_failed',
        message: 'executor failed',
        retryable: false,
      },
    } satisfies TaskOutput;

    expect(applyRuntimeSessionUploadFailure(output, new Error('s3 down'))).toBe(
      output,
    );
  });
});
