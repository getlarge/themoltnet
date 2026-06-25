import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

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

export function createApiRuntimeSessionStore(args: {
  agent: Agent;
}): RuntimeSessionStore {
  const { agent } = args;

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
      await agent.runtimeSessions.upload(
        { attemptN: input.attemptN, taskId: input.taskId },
        createReadStream(sessionPath),
        {
          parentSessionId: input.parentSessionId ?? undefined,
          sessionKind: input.sessionKind,
          sourceRuntimeProfileId: input.sourceRuntimeProfileId ?? undefined,
          sourceSlotId: input.sourceSlotId ?? undefined,
        },
        { teamId: input.teamId },
      );
    },
  };
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
