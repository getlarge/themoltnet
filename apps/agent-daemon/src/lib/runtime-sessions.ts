import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { TaskOutput } from '@moltnet/tasks';
import type { Agent, RuntimeSessionsNamespace } from '@themoltnet/sdk';

import { resolveLatestPiSessionPath } from './session-files.js';

export type RuntimeSessionKind = 'root' | 'extend' | 'fork';

export interface RuntimeSessionClaim {
  attemptN: number;
  task: {
    id: string;
    input: unknown;
    teamId: string;
  };
}

export interface RuntimeSessionStore {
  findRuntimeSessionByTaskAttempt(
    teamId: string,
    taskId: string,
    attemptN: number,
  ): ReturnType<RuntimeSessionsNamespace['getForAttempt']>;

  hydrateSession(input: {
    teamId: string;
    taskId: string;
    attemptN: number;
    destinationDir: string;
  }): Promise<string>;

  uploadAttemptFinal(input: {
    teamId: string;
    taskId: string;
    attemptN: number;
    sessionDir: string;
    sourceSlotId?: string | null;
    sourceRuntimeProfileId?: string | null;
    sessionKind: RuntimeSessionKind;
    parentSessionId?: string | null;
  }): Promise<void>;
}

export function resolveRuntimeSessionKind(
  claimedTask: RuntimeSessionClaim,
): RuntimeSessionKind {
  const continueFrom = resolveContinueFrom(claimedTask);
  if (!continueFrom) return 'root';
  return continueFrom.mode === 'fork' ? 'fork' : 'extend';
}

export async function resolveParentRuntimeSession(
  runtimeSessionStore: RuntimeSessionStore,
  claimedTask: RuntimeSessionClaim,
) {
  const continueFrom = resolveContinueFrom(claimedTask);
  if (!continueFrom) return null;
  return runtimeSessionStore.findRuntimeSessionByTaskAttempt(
    claimedTask.task.teamId,
    continueFrom.taskId,
    continueFrom.attemptN,
  );
}

export function applyRuntimeSessionUploadFailure(
  output: TaskOutput,
  err: unknown,
): TaskOutput {
  if (output.status !== 'completed') return output;
  return {
    ...output,
    contentSignature: undefined,
    error: {
      code: 'runtime_session_upload_failed',
      message:
        'Task completed, but durable runtime session checkpoint upload failed: ' +
        (err instanceof Error ? err.message : String(err)),
      retryable: isTransientUploadError(err),
    },
    output: null,
    outputCid: null,
    status: 'failed',
  };
}

export interface UploadRetryOptions {
  /** Total tries including the first (default 3). */
  maxTries?: number;
  /** Backoff base; the delay before try N+1 is `baseDelayMs * N` (default 750). */
  baseDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Transient faults worth retrying in-attempt: network-level errors
 * (no HTTP status at all) and 5xx/429 responses. A 4xx (auth,
 * validation, not-found) will not heal on retry.
 */
export function isTransientUploadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode !== 'number') return true;
  return statusCode >= 500 || statusCode === 429;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createApiRuntimeSessionStore(args: {
  agent: Agent;
  uploadRetry?: UploadRetryOptions;
  logger?: {
    warn(context: Record<string, unknown>, message: string): void;
  };
}): RuntimeSessionStore {
  const { agent, logger, uploadRetry } = args;

  return {
    async findRuntimeSessionByTaskAttempt(teamId, taskId, attemptN) {
      return agent.runtimeSessions.getForAttempt(
        { attemptN, taskId },
        { teamId },
      );
    },

    async hydrateSession(input) {
      const downloaded = await agent.runtimeSessions.download(
        {
          attemptN: input.attemptN,
          taskId: input.taskId,
        },
        { teamId: input.teamId },
      );
      await mkdir(input.destinationDir, { recursive: true });
      const sessionPath = join(
        input.destinationDir,
        `remote-${input.taskId}-attempt-${input.attemptN}.jsonl`,
      );
      await pipeline(downloaded, createWriteStream(sessionPath));
      return sessionPath;
    },

    async uploadAttemptFinal(input) {
      const sessionPath = resolveLatestPiSessionPath(input.sessionDir);
      if (!sessionPath) {
        throw new Error(
          `Cannot upload runtime session for ${input.taskId}/${input.attemptN}: no local session file in ${input.sessionDir}`,
        );
      }
      // A transient checkpoint-upload fault must not burn the attempt:
      // the executor work is already done, and re-running a whole
      // attempt only to redo one HTTP PUT is the wrong retry layer.
      // Retry here with backoff; only a persistent failure escalates
      // into `applyRuntimeSessionUploadFailure` at the call site.
      const maxTries = uploadRetry?.maxTries ?? 3;
      const baseDelayMs = uploadRetry?.baseDelayMs ?? 750;
      const sleep = uploadRetry?.sleep ?? defaultSleep;
      for (let tryN = 1; ; tryN += 1) {
        try {
          await agent.runtimeSessions.upload(
            { attemptN: input.attemptN, taskId: input.taskId },
            // The body stream is consumed even by a failed try; a
            // fresh stream per try keeps retries from PUTting an
            // empty body.
            createReadStream(sessionPath),
            {
              parentSessionId: input.parentSessionId ?? undefined,
              sessionKind: input.sessionKind,
              sourceRuntimeProfileId: input.sourceRuntimeProfileId ?? undefined,
              sourceSlotId: input.sourceSlotId ?? undefined,
            },
            { teamId: input.teamId },
          );
          return;
        } catch (error) {
          if (tryN >= maxTries || !isTransientUploadError(error)) {
            throw error;
          }
          const delayMs = baseDelayMs * tryN;
          logger?.warn(
            {
              event: 'agent-daemon.runtime_session_upload_retry',
              attemptN: input.attemptN,
              delayMs,
              statusCode: uploadStatusCode(error),
              taskId: input.taskId,
              tryN,
            },
            'Retrying durable runtime session upload',
          );
          await sleep(delayMs);
        }
      }
    },
  };
}

function uploadStatusCode(error: unknown): number | undefined {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

function resolveContinueFrom(claimedTask: RuntimeSessionClaim):
  | {
      attemptN: number;
      mode?: 'extend' | 'fork';
      taskId: string;
    }
  | undefined {
  return (
    claimedTask.task.input as {
      continueFrom?: {
        attemptN: number;
        mode?: 'extend' | 'fork';
        taskId: string;
      };
    }
  ).continueFrom;
}
