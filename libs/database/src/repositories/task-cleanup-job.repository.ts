import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewTaskCleanupJob,
  runtimeSessions,
  type Task,
  taskArtifacts,
  type TaskCleanupJob,
  taskCleanupJobs,
  tasks,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export interface TaskCleanupObjectRef {
  id: string;
  objectKey: string;
  sizeBytes: number;
}

export interface TaskCleanupManifest {
  task: {
    id: string;
    teamId: string;
    diaryId: string | null;
    claimAgentId: string | null;
  };
  taskArtifacts: TaskCleanupObjectRef[];
  runtimeSessions: TaskCleanupObjectRef[];
  createdAt: string;
}

export interface TaskCleanupJobWithManifest extends TaskCleanupJob {
  manifest: TaskCleanupManifest;
}

export class TaskCleanupJobMissingManifestError extends Error {
  constructor(jobId: string) {
    super(`Task cleanup job has no manifest: ${jobId}`);
    this.name = 'TaskCleanupJobMissingManifestError';
  }
}

export function createTaskCleanupJobRepository(db: Database) {
  async function findById(id: string): Promise<TaskCleanupJob | null> {
    const [row] = await getExecutor(db)
      .select()
      .from(taskCleanupJobs)
      .where(eq(taskCleanupJobs.id, id))
      .limit(1);
    return row ?? null;
  }

  return {
    async createRetentionJobsForTasks(
      retainedTasks: Pick<Task, 'id' | 'teamId'>[],
    ): Promise<TaskCleanupJob[]> {
      if (retainedTasks.length === 0) return [];
      const values: NewTaskCleanupJob[] = retainedTasks.map((task) => ({
        taskId: task.id,
        teamId: task.teamId,
        reason: 'retention',
        status: 'pending',
        workflowId: taskCleanupWorkflowId(task.id),
      }));
      const inserted = await getExecutor(db)
        .insert(taskCleanupJobs)
        .values(values)
        .onConflictDoNothing({ target: taskCleanupJobs.taskId })
        .returning();

      const insertedTaskIds = new Set(inserted.map((job) => job.taskId));
      const retryableTaskIds = retainedTasks
        .map((task) => task.id)
        .filter((taskId) => !insertedTaskIds.has(taskId));
      if (retryableTaskIds.length === 0) return inserted;

      const existingRetryable = await getExecutor(db)
        .update(taskCleanupJobs)
        .set({
          status: 'pending',
          error: null,
          completedAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            inArray(taskCleanupJobs.taskId, retryableTaskIds),
            inArray(taskCleanupJobs.status, ['pending', 'failed']),
          ),
        )
        .returning();
      return [...inserted, ...existingRetryable];
    },

    async listPendingOrFailedRetentionJobs(
      limit: number,
    ): Promise<TaskCleanupJob[]> {
      return getExecutor(db)
        .select()
        .from(taskCleanupJobs)
        .where(
          and(
            eq(taskCleanupJobs.reason, 'retention'),
            inArray(taskCleanupJobs.status, ['pending', 'failed']),
          ),
        )
        .orderBy(asc(taskCleanupJobs.createdAt))
        .limit(limit);
    },

    findById,

    async start(id: string): Promise<TaskCleanupJob | null> {
      const [row] = await getExecutor(db)
        .update(taskCleanupJobs)
        .set({
          status: 'running',
          startedAt: sql`coalesce(${taskCleanupJobs.startedAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(taskCleanupJobs.id, id),
            inArray(taskCleanupJobs.status, ['pending', 'running']),
          ),
        )
        .returning();
      return row ?? null;
    },

    async getOrCreateManifest(id: string): Promise<TaskCleanupManifest | null> {
      const existing = await findById(id);
      if (!existing) return null;
      const parsed = parseManifest(existing.manifest);
      if (parsed) return parsed;

      const [task] = await getExecutor(db)
        .select({
          id: tasks.id,
          teamId: tasks.teamId,
          diaryId: tasks.diaryId,
          claimAgentId: tasks.claimAgentId,
        })
        .from(tasks)
        .where(eq(tasks.id, existing.taskId))
        .limit(1);
      if (!task) return null;

      const [artifactRows, sessionRows] = await Promise.all([
        getExecutor(db)
          .select({
            id: taskArtifacts.id,
            objectKey: taskArtifacts.objectKey,
            sizeBytes: taskArtifacts.sizeBytes,
          })
          .from(taskArtifacts)
          .where(eq(taskArtifacts.taskId, existing.taskId)),
        getExecutor(db)
          .select({
            id: runtimeSessions.id,
            objectKey: runtimeSessions.objectKey,
            sizeBytes: runtimeSessions.sizeBytes,
          })
          .from(runtimeSessions)
          .where(
            and(
              eq(runtimeSessions.taskId, existing.taskId),
              isNull(runtimeSessions.deletedAt),
            ),
          ),
      ]);

      const manifest: TaskCleanupManifest = {
        task,
        taskArtifacts: artifactRows,
        runtimeSessions: sessionRows,
        createdAt: new Date().toISOString(),
      };
      const objectCount =
        manifest.taskArtifacts.length + manifest.runtimeSessions.length;
      const objectBytes = [
        ...manifest.taskArtifacts,
        ...manifest.runtimeSessions,
      ].reduce((sum, object) => sum + object.sizeBytes, 0);

      const [updated] = await getExecutor(db)
        .update(taskCleanupJobs)
        .set({
          manifest,
          objectCount,
          objectBytes,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(taskCleanupJobs.id, id), isNull(taskCleanupJobs.manifest)),
        )
        .returning();

      if (updated) return manifest;
      const raced = await findById(id);
      return parseManifest(raced?.manifest);
    },

    async detachRuntimeSessionChildren(sessionIds: string[]): Promise<void> {
      if (sessionIds.length === 0) return;
      await getExecutor(db)
        .update(runtimeSessions)
        .set({ parentSessionId: null, updatedAt: sql`now()` })
        .where(inArray(runtimeSessions.parentSessionId, sessionIds));
    },

    async complete(id: string, deletedTaskCount: number): Promise<void> {
      await getExecutor(db)
        .update(taskCleanupJobs)
        .set({
          status: 'completed',
          deletedTaskCount,
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(taskCleanupJobs.id, id));
    },

    async fail(id: string, error: unknown): Promise<void> {
      await getExecutor(db)
        .update(taskCleanupJobs)
        .set({
          status: 'failed',
          error: serializeCleanupError(error),
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(taskCleanupJobs.id, id));
    },
  };
}

function taskCleanupWorkflowId(taskId: string): string {
  return `task-cleanup:${taskId}`;
}

function parseManifest(value: unknown): TaskCleanupManifest | null {
  if (!value || typeof value !== 'object') return null;
  const manifest = value as Partial<TaskCleanupManifest>;
  if (
    !manifest.task ||
    !Array.isArray(manifest.taskArtifacts) ||
    !Array.isArray(manifest.runtimeSessions)
  ) {
    return null;
  }
  return manifest as TaskCleanupManifest;
}

function serializeCleanupError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

export type TaskCleanupJobRepository = ReturnType<
  typeof createTaskCleanupJobRepository
>;
