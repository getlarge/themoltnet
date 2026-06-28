import { and, asc, eq, or, sql } from 'drizzle-orm';

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

export function createTaskArtifactRepository(db: Database) {
  async function findExistingForAttempt(
    input: Pick<
      CreateTaskArtifactInput,
      'teamId' | 'taskId' | 'attemptN' | 'cid'
    >,
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
      input: CreateTaskArtifactInput,
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
        throw new Error('failed to insert task artifact');
      }
      return { artifact: existing, created: false };
    },

    findExistingForAttempt,

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

    async listForTask(
      input: ListTaskArtifactsInput,
    ): Promise<ListTaskArtifactsResult> {
      const createdAtCursorKey = sql`date_trunc('milliseconds', ${taskArtifacts.createdAt})`;
      const rows = await getExecutor(db)
        .select()
        .from(taskArtifacts)
        .where(
          and(
            eq(taskArtifacts.teamId, input.teamId),
            eq(taskArtifacts.taskId, input.taskId),
            input.cursor
              ? or(
                  sql`${taskArtifacts.attemptN} > ${input.cursor.attemptN}`,
                  and(
                    eq(taskArtifacts.attemptN, input.cursor.attemptN),
                    sql`${createdAtCursorKey} > ${input.cursor.createdAt}`,
                  ),
                  and(
                    eq(taskArtifacts.attemptN, input.cursor.attemptN),
                    sql`${createdAtCursorKey} = ${input.cursor.createdAt}`,
                    sql`${taskArtifacts.id} > ${input.cursor.id}`,
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(
          asc(taskArtifacts.attemptN),
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
  };
}

function encodeTaskArtifactCursor(artifact: TaskArtifact): string {
  return Buffer.from(
    JSON.stringify({
      attemptN: artifact.attemptN,
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
