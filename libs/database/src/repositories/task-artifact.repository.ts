import { and, eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewTaskArtifact,
  type TaskArtifact,
  taskArtifacts,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export interface CreateTaskArtifactInput {
  teamId: string;
  taskId: string;
  attemptN: number;
  kind: string;
  title: string;
  objectKey: string;
  contentType: string;
  contentEncoding?: string | null;
  sizeBytes: number;
  sha256: string;
  cid: string;
  createdByAgentId: string;
  expiresAt?: Date | null;
}

export function createTaskArtifactRepository(db: Database) {
  return {
    async createForAttempt(
      input: CreateTaskArtifactInput,
    ): Promise<TaskArtifact> {
      const [inserted] = await getExecutor(db)
        .insert(taskArtifacts)
        .values(toTaskArtifactValues(input))
        .onConflictDoUpdate({
          target: [
            taskArtifacts.teamId,
            taskArtifacts.taskId,
            taskArtifacts.attemptN,
            taskArtifacts.cid,
          ],
          set: {
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!inserted) {
        throw new Error('failed to insert task artifact');
      }
      return inserted;
    },

    async findByCidForAttempt(input: {
      teamId: string;
      taskId: string;
      attemptN: number;
      cid: string;
    }): Promise<TaskArtifact | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(taskArtifacts)
        .where(
          and(
            eq(taskArtifacts.teamId, input.teamId),
            eq(taskArtifacts.taskId, input.taskId),
            eq(taskArtifacts.attemptN, input.attemptN),
            eq(taskArtifacts.cid, input.cid),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async listForTask(input: {
      teamId: string;
      taskId: string;
    }): Promise<TaskArtifact[]> {
      return getExecutor(db)
        .select()
        .from(taskArtifacts)
        .where(
          and(
            eq(taskArtifacts.teamId, input.teamId),
            eq(taskArtifacts.taskId, input.taskId),
          ),
        );
    },
  };
}

function toTaskArtifactValues(input: CreateTaskArtifactInput): NewTaskArtifact {
  return {
    attemptN: input.attemptN,
    cid: input.cid,
    contentEncoding: input.contentEncoding ?? null,
    contentType: input.contentType,
    createdByAgentId: input.createdByAgentId,
    expiresAt: input.expiresAt ?? null,
    kind: input.kind,
    objectKey: input.objectKey,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    taskId: input.taskId,
    teamId: input.teamId,
    title: input.title,
  };
}

export type TaskArtifactRepository = ReturnType<
  typeof createTaskArtifactRepository
>;
