import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TaskOutput } from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  applyRuntimeSessionUploadFailure,
  createApiRuntimeSessionStore,
  isTransientUploadError,
} from './runtime-sessions.js';

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
  it('turns a completed output into a retryable failure for transient checkpoint errors', () => {
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

  it('keeps persistent checkpoint upload failures non-retryable', () => {
    const result = applyRuntimeSessionUploadFailure(
      makeOutput('completed'),
      makeHttpError(403),
    );

    expect(result.error).toMatchObject({
      code: 'runtime_session_upload_failed',
      retryable: false,
    });
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

function makeHttpError(statusCode: number): Error {
  return Object.assign(new Error(`http ${statusCode}`), { statusCode });
}

function makeSessionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-sessions-test-'));
  writeFileSync(join(dir, 'session.jsonl'), '{"type":"session"}\n');
  return dir;
}

function makeStore(
  upload: ReturnType<typeof vi.fn>,
  uploadRetry?: Parameters<
    typeof createApiRuntimeSessionStore
  >[0]['uploadRetry'],
) {
  const agent = { runtimeSessions: { upload } } as unknown as Agent;
  return createApiRuntimeSessionStore({ agent, uploadRetry });
}

const UPLOAD_INPUT = {
  attemptN: 1,
  parentSessionId: null,
  sessionKind: 'root' as const,
  sourceRuntimeProfileId: null,
  sourceSlotId: null,
  taskId: 'task-1',
  teamId: 'team-1',
};

describe('isTransientUploadError', () => {
  it('treats 5xx and 429 as transient', () => {
    expect(isTransientUploadError(makeHttpError(500))).toBe(true);
    expect(isTransientUploadError(makeHttpError(503))).toBe(true);
    expect(isTransientUploadError(makeHttpError(429))).toBe(true);
  });

  it('treats other 4xx as persistent', () => {
    expect(isTransientUploadError(makeHttpError(400))).toBe(false);
    expect(isTransientUploadError(makeHttpError(403))).toBe(false);
    expect(isTransientUploadError(makeHttpError(404))).toBe(false);
  });

  it('treats status-less errors as transient network faults and non-errors as persistent', () => {
    expect(isTransientUploadError(new Error('socket hang up'))).toBe(true);
    expect(isTransientUploadError('nope')).toBe(false);
  });
});

describe('uploadAttemptFinal in-attempt retry', () => {
  it('retries a transient failure with backoff and succeeds without burning the attempt', async () => {
    // Arrange
    const sessionDir = makeSessionDir();
    const upload = vi
      .fn()
      .mockRejectedValueOnce(makeHttpError(503))
      .mockRejectedValueOnce(makeHttpError(503))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = { warn: vi.fn() };
    const agent = { runtimeSessions: { upload } } as unknown as Agent;
    const store = createApiRuntimeSessionStore({
      agent,
      logger,
      uploadRetry: { baseDelayMs: 750, sleep },
    });

    // Act
    await store.uploadAttemptFinal({ ...UPLOAD_INPUT, sessionDir });

    // Assert
    expect(upload).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0] as number)).toEqual([
      750, 1500,
    ]);
    // A fresh body stream per try: a consumed stream would make the
    // retried PUT upload an empty body.
    const bodies = upload.mock.calls.map((call) => call[1] as unknown);
    expect(new Set(bodies).size).toBe(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'agent-daemon.runtime_session_upload_retry',
        taskId: 'task-1',
        tryN: 1,
        delayMs: 750,
        statusCode: 503,
      }),
      'Retrying durable runtime session upload',
    );
  });

  it('does not retry a persistent 4xx failure', async () => {
    // Arrange
    const sessionDir = makeSessionDir();
    const upload = vi.fn().mockRejectedValue(makeHttpError(403));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const store = makeStore(upload, { sleep });

    // Act + Assert
    await expect(
      store.uploadAttemptFinal({ ...UPLOAD_INPUT, sessionDir }),
    ).rejects.toThrow('http 403');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after the retry budget and rethrows the last transient error', async () => {
    // Arrange
    const sessionDir = makeSessionDir();
    const upload = vi.fn().mockRejectedValue(makeHttpError(503));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const store = makeStore(upload, { maxTries: 2, sleep });

    // Act + Assert
    await expect(
      store.uploadAttemptFinal({ ...UPLOAD_INPUT, sessionDir }),
    ).rejects.toThrow('http 503');
    expect(upload).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
