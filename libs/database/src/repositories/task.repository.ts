import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewTask,
  type NewTaskAttempt,
  type NewTaskMessage,
  type Task,
  type TaskAttempt,
  taskAttempts,
  type TaskMessage,
  taskMessages,
  tasks,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

const PAGE_SIZE = 50;

export function createTaskRepository(db: Database) {
  return {
    async create(input: NewTask): Promise<Task> {
      const [row] = await getExecutor(db)
        .insert(tasks)
        .values(input)
        .returning();
      return row;
    },

    async findById(id: string): Promise<Task | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);
      return row ?? null;
    },

    async list(opts: {
      teamId: string;
      status?: Task['status'];
      taskType?: string;
      correlationId?: string;
      limit?: number;
      cursor?: string;
    }): Promise<{ items: Task[]; nextCursor?: string }> {
      const limit = Math.min(opts.limit ?? PAGE_SIZE, PAGE_SIZE);
      const filters = [eq(tasks.teamId, opts.teamId)];
      if (opts.status) filters.push(eq(tasks.status, opts.status));
      if (opts.taskType) filters.push(eq(tasks.taskType, opts.taskType));
      if (opts.correlationId)
        filters.push(eq(tasks.correlationId, opts.correlationId));
      if (opts.cursor) filters.push(lt(tasks.createdAt, new Date(opts.cursor)));

      const rows = await getExecutor(db)
        .select()
        .from(tasks)
        .where(and(...filters))
        .orderBy(desc(tasks.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? items[items.length - 1].createdAt.toISOString()
        : undefined;
      return { items, nextCursor };
    },

    async claimIfQueued(id: string): Promise<Task | null> {
      const [row] = await getExecutor(db)
        .update(tasks)
        .set({ status: 'dispatched', updatedAt: sql`now()` })
        .where(and(eq(tasks.id, id), eq(tasks.status, 'queued')))
        .returning();
      return row ?? null;
    },

    async updateStatus(
      id: string,
      status: Task['status'],
      extra?: Partial<
        Pick<
          Task,
          | 'completedAt'
          | 'cancelReason'
          | 'cancelledByAgentId'
          | 'cancelledByHumanId'
          | 'acceptedAttemptN'
          | 'claimAgentId'
          | 'claimExpiresAt'
        >
      >,
    ): Promise<Task | null> {
      const [row] = await getExecutor(db)
        .update(tasks)
        .set({ status, updatedAt: sql`now()`, ...extra })
        .where(eq(tasks.id, id))
        .returning();
      return row ?? null;
    },

    async createAttempt(input: NewTaskAttempt): Promise<TaskAttempt> {
      const [row] = await getExecutor(db)
        .insert(taskAttempts)
        .values(input)
        .returning();
      return row;
    },

    async findAttempt(
      taskId: string,
      attemptN: number,
    ): Promise<TaskAttempt | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(taskAttempts)
        .where(
          and(
            eq(taskAttempts.taskId, taskId),
            eq(taskAttempts.attemptN, attemptN),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async updateAttempt(
      taskId: string,
      attemptN: number,
      fields: Partial<
        Pick<
          TaskAttempt,
          | 'status'
          | 'startedAt'
          | 'completedAt'
          | 'output'
          | 'outputCid'
          | 'error'
          | 'usage'
          | 'contentSignature'
          | 'signedAt'
        >
      >,
    ): Promise<TaskAttempt | null> {
      const [row] = await getExecutor(db)
        .update(taskAttempts)
        .set(fields)
        .where(
          and(
            eq(taskAttempts.taskId, taskId),
            eq(taskAttempts.attemptN, attemptN),
          ),
        )
        .returning();
      return row ?? null;
    },

    async listAttempts(taskId: string): Promise<TaskAttempt[]> {
      return getExecutor(db)
        .select()
        .from(taskAttempts)
        .where(eq(taskAttempts.taskId, taskId))
        .orderBy(asc(taskAttempts.attemptN));
    },

    async countAttempts(taskId: string): Promise<number> {
      const [row] = await getExecutor(db)
        .select({ count: sql<number>`count(*)::int` })
        .from(taskAttempts)
        .where(eq(taskAttempts.taskId, taskId));
      return row?.count ?? 0;
    },

    async getMaxAttempts(taskId: string): Promise<number> {
      const [row] = await getExecutor(db)
        .select({ maxAttempts: tasks.maxAttempts })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
      return row?.maxAttempts ?? 1;
    },

    async findMaxMessageSeq(taskId: string, attemptN: number): Promise<number> {
      const [row] = await getExecutor(db)
        .select({ maxSeq: sql<number | null>`max(${taskMessages.seq})` })
        .from(taskMessages)
        .where(
          and(
            eq(taskMessages.taskId, taskId),
            eq(taskMessages.attemptN, attemptN),
          ),
        );
      // MAX() always returns a row (with null when there are no rows), so `row`
      // is never undefined — only `maxSeq` can be null when the table is empty.
      return row.maxSeq ?? -1;
    },

    async appendMessages(
      messages: Omit<NewTaskMessage, 'seq'>[],
    ): Promise<void> {
      if (messages.length === 0) return;
      // Seq numbers are generated atomically inside the DB to avoid the
      // read-then-write race: two concurrent callers could read the same
      // maxSeq and then try to insert rows with overlapping seq values.
      //
      // Strategy: INSERT ... SELECT from a VALUES list joined with a
      // ROW_NUMBER() window function, offset by COALESCE(MAX(seq), -1).
      // The correlated subquery for MAX(seq) is evaluated once per statement
      // against the committed snapshot, so concurrent inserts get disjoint
      // seq ranges (assuming a UNIQUE constraint on (task_id, attempt_n, seq)).
      const taskId = messages[0].taskId;
      const attemptN = messages[0].attemptN;

      // Build the VALUES rows for the inline table: (kind, payload, timestamp)
      const valuesTuples = messages
        .map(
          (m) =>
            sql`(${m.kind}::text, ${JSON.stringify(m.payload)}::jsonb, ${m.timestamp ?? new Date()})`,
        )
        .reduce((acc, cur) => sql`${acc}, ${cur}`);

      await getExecutor(db).execute(sql`
        INSERT INTO task_messages (task_id, attempt_n, seq, timestamp, kind, payload)
        SELECT
          ${taskId}::uuid,
          ${attemptN}::smallint,
          (SELECT COALESCE(MAX(seq), -1) FROM task_messages
            WHERE task_id = ${taskId}::uuid AND attempt_n = ${attemptN}::smallint)
            + ROW_NUMBER() OVER (ORDER BY ts),
          ts,
          kind,
          payload
        FROM (VALUES ${valuesTuples}) AS v(kind, payload, ts)
      `);
    },

    async listMessages(
      taskId: string,
      attemptN: number,
      opts: { afterSeq?: number; limit?: number } = {},
    ): Promise<{ items: TaskMessage[]; hasMore: boolean }> {
      const limit = Math.min(opts.limit ?? PAGE_SIZE, PAGE_SIZE);
      const filters = [
        eq(taskMessages.taskId, taskId),
        eq(taskMessages.attemptN, attemptN),
      ];
      if (opts.afterSeq !== undefined) {
        filters.push(gt(taskMessages.seq, opts.afterSeq));
      }
      const rows = await getExecutor(db)
        .select()
        .from(taskMessages)
        .where(and(...filters))
        .orderBy(asc(taskMessages.seq))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
    },
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
