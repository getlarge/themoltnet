import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewRuntimeSession,
  type RuntimeSession,
  runtimeSessions,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export type RuntimeSessionKind = 'root' | 'extend' | 'fork';
export type RuntimeSessionCheckpointKind = 'attempt_final';

export interface UpsertRuntimeSessionInput {
  teamId: string;
  taskId: string;
  attemptN: number;
  sourceSlotId?: string | null;
  sourceRuntimeProfileId?: string | null;
  sessionKind: RuntimeSessionKind;
  parentSessionId?: string | null;
  objectKey: string;
  contentType: string;
  contentEncoding?: string | null;
  sizeBytes: number;
  sha256: string;
  storageClass: string;
  checkpointKind?: RuntimeSessionCheckpointKind;
}

export interface RuntimeSessionCleanupRef {
  id: string;
  taskId: string;
  objectKey: string;
  sizeBytes: number;
}

export function createRuntimeSessionRepository(db: Database) {
  return {
    async upsertActive(
      input: UpsertRuntimeSessionInput,
    ): Promise<RuntimeSession> {
      const patch = toRuntimeSessionValues(input);
      const [updated] = await getExecutor(db)
        .update(runtimeSessions)
        .set({
          ...patch,
          updatedAt: sql`now()`,
          uploadedAt: sql`now()`,
        })
        .where(activeAttemptWhere(input.teamId, input.taskId, input.attemptN))
        .returning();

      if (updated) return updated;

      const [inserted] = await getExecutor(db)
        .insert(runtimeSessions)
        .values(patch)
        .returning();
      if (!inserted) {
        throw new Error('failed to insert runtime session');
      }
      return inserted;
    },

    async findActiveByTaskAttempt(
      teamId: string,
      taskId: string,
      attemptN: number,
    ): Promise<RuntimeSession | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeSessions)
        .where(activeAttemptWhere(teamId, taskId, attemptN))
        .limit(1);
      return row ?? null;
    },

    async findByIdInTeam(
      id: string,
      teamId: string,
    ): Promise<RuntimeSession | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeSessions)
        .where(
          and(
            eq(runtimeSessions.id, id),
            eq(runtimeSessions.teamId, teamId),
            isNull(runtimeSessions.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async listCleanupRefsForTasks(
      taskIds: string[],
    ): Promise<RuntimeSessionCleanupRef[]> {
      if (taskIds.length === 0) return [];
      return getExecutor(db)
        .select({
          id: runtimeSessions.id,
          taskId: runtimeSessions.taskId,
          objectKey: runtimeSessions.objectKey,
          sizeBytes: runtimeSessions.sizeBytes,
        })
        .from(runtimeSessions)
        .where(
          and(
            inArray(runtimeSessions.taskId, taskIds),
            isNull(runtimeSessions.deletedAt),
          ),
        );
    },

    async detachChildren(sessionIds: string[]): Promise<void> {
      if (sessionIds.length === 0) return;
      await getExecutor(db)
        .update(runtimeSessions)
        .set({ parentSessionId: null, updatedAt: sql`now()` })
        .where(inArray(runtimeSessions.parentSessionId, sessionIds));
    },
  };
}

function toRuntimeSessionValues(
  input: UpsertRuntimeSessionInput,
): NewRuntimeSession {
  return {
    attemptN: input.attemptN,
    checkpointKind: input.checkpointKind ?? 'attempt_final',
    contentEncoding: input.contentEncoding ?? null,
    contentType: input.contentType,
    objectKey: input.objectKey,
    parentSessionId: input.parentSessionId ?? null,
    sessionKind: input.sessionKind,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    sourceRuntimeProfileId: input.sourceRuntimeProfileId ?? null,
    sourceSlotId: input.sourceSlotId ?? null,
    storageClass: input.storageClass,
    taskId: input.taskId,
    teamId: input.teamId,
  };
}

function activeAttemptWhere(teamId: string, taskId: string, attemptN: number) {
  return and(
    eq(runtimeSessions.teamId, teamId),
    eq(runtimeSessions.taskId, taskId),
    eq(runtimeSessions.attemptN, attemptN),
    isNull(runtimeSessions.deletedAt),
  );
}

export type RuntimeSessionRepository = ReturnType<
  typeof createRuntimeSessionRepository
>;
