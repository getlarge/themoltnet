import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';

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
  attemptN: number | null;
  kind: string;
  title: string;
  objectKey: string;
  contentType: string;
  contentEncoding?: string | null;
  sizeBytes: number;
  sha256: string;
  cid: string;
  createdByAgentId: string | null;
  expiresAt?: Date | null;
}

export type CreateTaskInputArtifactInput = Omit<
  CreateTaskArtifactInput,
  'attemptN'
>;

export type CreateTaskAttemptArtifactInput = CreateTaskArtifactInput & {
  attemptN: number;
  createdByAgentId: string;
};

export interface ListTaskArtifactsInput {
  teamId: string;
  taskId: string;
  limit: number;
  cursor?: {
    attemptN: number;
    createdAt: Date;
    id: string;
  };
}

export interface ListTaskArtifactsResult {
  artifacts: TaskArtifact[];
  nextCursor: string | null;
}

export interface CreateTaskArtifactResult {
  artifact: TaskArtifact;
  created: boolean;
}

export interface TaskArtifactCleanupRef {
  id: string;
  taskId: string;
  objectKey: string;
  sizeBytes: number;
}

export class TaskArtifactConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskArtifactConflictError';
  }
}

export function createTaskArtifactRepository(db: Database) {
  async function findExistingForAttempt(
    input: Pick<CreateTaskArtifactInput, 'teamId' | 'taskId' | 'cid'> & {
      attemptN: number;
    },
  ): Promise<TaskArtifact | null> {
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
  }

  return {
    async createForAttempt(
      input: CreateTaskAttemptArtifactInput,
    ): Promise<CreateTaskArtifactResult> {
      const [inserted] = await getExecutor(db)
        .insert(taskArtifacts)
        .values(toTaskArtifactValues(input))
        .onConflictDoNothing({
          target: [
            taskArtifacts.teamId,
            taskArtifacts.taskId,
            taskArtifacts.attemptN,
            taskArtifacts.cid,
          ],
        })
        .returning();
      if (inserted) {
        return { artifact: inserted, created: true };
      }
      const existing = await findExistingForAttempt(input);
      if (!existing) {
        throw new TaskArtifactConflictError(
          'Task artifact insert conflicted but no matching artifact was found',
        );
      }
      return { artifact: existing, created: false };
    },

    findExistingForAttempt,

    /**
     * Insert an input artifact row (attempt_n NULL) for a task. Only used
     * inside the task-create transaction where the task row is brand new,
     * so no conflict handling is needed — duplicate CIDs are rejected by
     * validation and the partial unique index is the safety net.
     */
    async createForTask(
      input: CreateTaskInputArtifactInput,
    ): Promise<TaskArtifact> {
      const [inserted] = await getExecutor(db)
        .insert(taskArtifacts)
        .values(toTaskArtifactValues({ ...input, attemptN: null }))
        .returning();
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

    /**
     * Resolve an artifact row by CID for a whole task, regardless of
     * attempt. When the same CID exists as both an input artifact and an
     * attempt output, the input row (attempt_n NULL) wins — the bytes are
     * identical either way, only metadata differs.
     */
    async findByCidForTask(input: {
      teamId: string;
      taskId: string;
      cid: string;
    }): Promise<TaskArtifact | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(taskArtifacts)
        .where(
          and(
            eq(taskArtifacts.teamId, input.teamId),
            eq(taskArtifacts.taskId, input.taskId),
            eq(taskArtifacts.cid, input.cid),
          ),
        )
        .orderBy(sql`${taskArtifacts.attemptN} ASC NULLS FIRST`)
        .limit(1);
      return row ?? null;
    },

    async listForTask(
      input: ListTaskArtifactsInput,
    ): Promise<ListTaskArtifactsResult> {
      const createdAtCursorKey = sql`date_trunc('milliseconds', ${taskArtifacts.createdAt})`;
      // Input artifacts have attempt_n NULL; sort them before attempt 1
      // (attempts start at 1) so cursor pagination covers them. Cursors
      // encode NULL attempt_n as 0 for the same reason.
      const attemptSortKey = sql`COALESCE(${taskArtifacts.attemptN}, 0)`;
      const rows = await getExecutor(db)
        .select()
        .from(taskArtifacts)
        .where(
          and(
            eq(taskArtifacts.teamId, input.teamId),
            eq(taskArtifacts.taskId, input.taskId),
            input.cursor
              ? or(
                  sql`${attemptSortKey} > ${input.cursor.attemptN}`,
                  and(
                    sql`${attemptSortKey} = ${input.cursor.attemptN}`,
                    sql`${createdAtCursorKey} > ${input.cursor.createdAt}`,
                  ),
                  and(
                    sql`${attemptSortKey} = ${input.cursor.attemptN}`,
                    sql`${createdAtCursorKey} = ${input.cursor.createdAt}`,
                    sql`${taskArtifacts.id} > ${input.cursor.id}`,
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(
          asc(attemptSortKey),
          asc(createdAtCursorKey),
          asc(taskArtifacts.id),
        )
        .limit(input.limit + 1);
      const artifacts = rows.slice(0, input.limit);
      const last = artifacts.at(-1);
      return {
        artifacts,
        nextCursor:
          rows.length > input.limit && last
            ? encodeTaskArtifactCursor(last)
            : null,
      };
    },

    async listCleanupRefsForTasks(
      taskIds: string[],
    ): Promise<TaskArtifactCleanupRef[]> {
      if (taskIds.length === 0) return [];
      return getExecutor(db)
        .select({
          id: taskArtifacts.id,
          taskId: taskArtifacts.taskId,
          objectKey: taskArtifacts.objectKey,
          sizeBytes: taskArtifacts.sizeBytes,
        })
        .from(taskArtifacts)
        .where(inArray(taskArtifacts.taskId, taskIds));
    },

    /**
     * Objects are shared by every row with the same CID in a team, so a
     * cleanup pass must not delete objects that rows of other tasks still
     * point at. Returns the subset of the given keys that still have rows.
     */
    async listObjectKeysStillReferenced(
      objectKeys: string[],
    ): Promise<string[]> {
      if (objectKeys.length === 0) return [];
      const rows = await getExecutor(db)
        .selectDistinct({ objectKey: taskArtifacts.objectKey })
        .from(taskArtifacts)
        .where(inArray(taskArtifacts.objectKey, objectKeys));
      return rows.map((row) => row.objectKey);
    },

    /**
     * Batch existence check for the orphan-object sweep: which of the
     * given (teamId, cid) pairs have at least one artifact row?
     */
    async filterCidsWithRows(
      pairs: { teamId: string; cid: string }[],
    ): Promise<{ teamId: string; cid: string }[]> {
      if (pairs.length === 0) return [];
      const cidsByTeam = new Map<string, string[]>();
      for (const pair of pairs) {
        const cids = cidsByTeam.get(pair.teamId) ?? [];
        cids.push(pair.cid);
        cidsByTeam.set(pair.teamId, cids);
      }
      return getExecutor(db)
        .selectDistinct({
          teamId: taskArtifacts.teamId,
          cid: taskArtifacts.cid,
        })
        .from(taskArtifacts)
        .where(
          or(
            ...[...cidsByTeam.entries()].map(([teamId, cids]) =>
              and(
                eq(taskArtifacts.teamId, teamId),
                inArray(taskArtifacts.cid, cids),
              ),
            ),
          ),
        );
    },
  };
}

function encodeTaskArtifactCursor(artifact: TaskArtifact): string {
  return Buffer.from(
    JSON.stringify({
      attemptN: artifact.attemptN ?? 0,
      createdAt: artifact.createdAt.toISOString(),
      id: artifact.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeTaskArtifactCursor(
  cursor: string,
): ListTaskArtifactsInput['cursor'] {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { attemptN?: unknown; createdAt?: unknown; id?: unknown };
    if (
      typeof parsed.attemptN !== 'number' ||
      !Number.isInteger(parsed.attemptN) ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new Error('invalid task artifact cursor');
    }
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('invalid task artifact cursor');
    }
    return { attemptN: parsed.attemptN, createdAt, id: parsed.id };
  } catch {
    throw new Error('invalid task artifact cursor');
  }
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
