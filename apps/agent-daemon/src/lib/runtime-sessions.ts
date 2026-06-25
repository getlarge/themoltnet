import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Agent, RuntimeSessionsNamespace } from '@themoltnet/sdk';

import { resolveLatestPiSessionPath } from './session-files.js';

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
    sessionKind: 'root' | 'extend' | 'fork';
    parentSessionId?: string | null;
  }): Promise<void>;
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
      mkdirSync(input.destinationDir, { recursive: true });
      const sessionPath = join(
        input.destinationDir,
        `remote-${input.taskId}-attempt-${input.attemptN}.jsonl`,
      );
      writeFileSync(
        sessionPath,
        Buffer.from(downloaded.contentBase64, 'base64'),
      );
      return sessionPath;
    },

    async uploadAttemptFinal(input) {
      const sessionPath = resolveLatestPiSessionPath(input.sessionDir);
      if (!sessionPath) {
        throw new Error(
          `Cannot upload runtime session for ${input.taskId}/${input.attemptN}: no local session file in ${input.sessionDir}`,
        );
      }
      const contentBase64 = readFileSync(sessionPath).toString('base64');
      await agent.runtimeSessions.upload(
        { attemptN: input.attemptN, taskId: input.taskId },
        {
          contentBase64,
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
