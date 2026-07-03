import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '../db.js';
import {
  correlationSeals,
  type ExecutorManifest,
  executorManifests,
  type ExecutorManifestVerification,
  executorManifestVerifications,
  type NewExecutorManifest,
  type NewExecutorManifestVerification,
  type NewTask,
  type NewTaskAttempt,
  type NewTaskAttemptActivityStats,
  type NewTaskMessage,
  runtimeProfiles,
  runtimeSessions,
  runtimeSlots,
  type Task,
  type TaskAttempt,
  type TaskAttemptActivityStats,
  taskAttemptActivityStats,
  taskAttempts,
  type TaskMessage,
  taskMessages,
  tasks,
} from '../schema.js';
import { getExecutor, hasActiveTransaction } from '../transaction-context.js';

const PAGE_SIZE = 50;

export interface TaskAttemptWithManifests extends TaskAttempt {
  claimedExecutorManifest: unknown;
  completedExecutorManifest: unknown;
}

/** Filters shared by `list` and `count` (everything except limit/cursor). */
export interface TaskListFilterOpts {
  teamId: string;
  query?: string;
  status?: Task['status'];
  statuses?: Task['status'][];
  taskTypes?: string[];
  tags?: string[];
  excludeTags?: string[];
  profileId?: string;
  correlationId?: string;
  diaryId?: string;
  proposedByAgentId?: string;
  proposedByHumanId?: string;
  claimedByAgentId?: string;
  hasAttempts?: boolean;
  queuedAfter?: Date;
  queuedBefore?: Date;
  completedAfter?: Date;
  completedBefore?: Date;
}

export interface TaskRetentionCutoffs {
  completedBefore: Date;
  failedBefore: Date;
  cancelledBefore: Date;
  expiredBefore: Date;
}

export type TaskActivityGroupBy =
  | 'none'
  | 'day'
  | 'tag'
  | 'taskType'
  | 'profile'
  | 'diary'
  | 'agent'
  | 'providerModel';

export interface TaskActivityAnalyticsFilter {
  teamId: string;
  completedAfter: Date;
  completedBefore: Date;
  tags?: string[];
  taskTypes?: string[];
  profileIds?: string[];
  diaryIds?: string[];
  claimedByAgentIds?: string[];
  groupBy?: TaskActivityGroupBy;
}

export interface TaskActivityMetricBucket {
  taskCount: number;
  acceptedTaskCount: number;
  firstAttemptAcceptedTaskCount: number;
  retryRecoveredTaskCount: number;
  terminalFailureTaskCount: number;
  attemptCount: number;
  acceptedAttemptCount: number;
  failedAttemptCount: number;
  timeoutAttemptCount: number;
  abortedAttemptCount: number;
  cancelledAttemptCount: number;
  retryAttemptCount: number;
  highFrictionAttemptCount: number;
  messageCount: number;
  turnCount: number;
  toolCallCount: number;
  failedToolCallCount: number;
  knowledgeToolCallCount: number;
  entrySearchCount: number;
  entryGetCount: number;
  packGetCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  extraAttemptCount: number;
  extraTokensBeforeAcceptance: number;
  medianTimeToAcceptedMs: number | null;
  medianTurnsPerAttempt: number | null;
  medianToolCallsPerAttempt: number | null;
}

export interface TaskActivityAnalyticsGroup {
  key: string;
  label: string;
  metrics: TaskActivityMetricBucket;
}

export interface TaskActivityAnalyticsResult {
  overall: TaskActivityMetricBucket;
  groups: TaskActivityAnalyticsGroup[];
  statsComplete: boolean;
}

interface TaskActivityAttemptRow {
  taskId: string;
  taskType: string;
  taskTags: string[];
  diaryId: string | null;
  taskStatus: Task['status'];
  acceptedAttemptN: number | null;
  taskQueuedAt: Date;
  taskCompletedAt: Date | null;
  attemptN: number;
  attemptStatus: TaskAttempt['status'];
  attemptCompletedAt: Date | null;
  claimedByAgentId: string;
  usage: unknown;
  profileId: string | null;
  provider: string | null;
  model: string | null;
  stats: TaskAttemptActivityStats | null;
}

export function createTaskRepository(db: Database) {
  const claimedManifest = alias(executorManifests, 'claimed_executor_manifest');
  const completedManifest = alias(
    executorManifests,
    'completed_executor_manifest',
  );

  function buildListFilters(opts: TaskListFilterOpts): SQL[] {
    const filters: SQL[] = [eq(tasks.teamId, opts.teamId)];
    const query = opts.query?.trim();
    if (query) {
      const pattern = `%${escapeLikePattern(query)}%`;
      const clauses: SQL[] = [
        sql`${tasks.taskType} ILIKE ${pattern} ESCAPE '\\'`,
        sql`${tasks.title} ILIKE ${pattern} ESCAPE '\\'`,
        sql`array_to_string(${tasks.tags}, ' ') ILIKE ${pattern} ESCAPE '\\'`,
        sql`${tasks.input}::text ILIKE ${pattern} ESCAPE '\\'`,
      ];
      if (looksLikeUuidPrefix(query)) {
        const idPrefix = `${escapeLikePattern(query)}%`;
        clauses.push(
          sql`${tasks.id}::text ILIKE ${idPrefix} ESCAPE '\\'`,
          sql`${tasks.correlationId}::text ILIKE ${idPrefix} ESCAPE '\\'`,
        );
      }
      filters.push(sql`(${sql.join(clauses, sql` OR `)})`);
    }
    if (opts.status) filters.push(eq(tasks.status, opts.status));
    const statuses = opts.statuses?.filter((s) => s.length > 0) ?? [];
    if (statuses.length === 1) {
      filters.push(eq(tasks.status, statuses[0]));
    } else if (statuses.length > 1) {
      filters.push(inArray(tasks.status, statuses));
    }
    const taskTypes =
      opts.taskTypes?.filter((taskType) => taskType.length > 0) ?? [];
    if (taskTypes.length === 1) {
      filters.push(eq(tasks.taskType, taskTypes[0]));
    } else if (taskTypes.length > 1) {
      filters.push(inArray(tasks.taskType, taskTypes));
    }
    const tags = normalizeList(opts.tags);
    if (tags.length > 0) {
      filters.push(
        sql`${tasks.tags} @> ARRAY[${sql.join(
          tags.map((tag) => sql`${tag}`),
          sql`,`,
        )}]::text[]`,
      );
    }
    const excludeTags = normalizeList(opts.excludeTags);
    if (excludeTags.length > 0) {
      filters.push(
        sql`NOT (${tasks.tags} && ARRAY[${sql.join(
          excludeTags.map((tag) => sql`${tag}`),
          sql`,`,
        )}]::text[])`,
      );
    }
    if (opts.profileId) {
      const profileJson = JSON.stringify([{ profileId: opts.profileId }]);
      filters.push(sql`(
        ${tasks.allowedProfiles} = '[]'::jsonb
        OR ${tasks.allowedProfiles} @> ${profileJson}::jsonb
      )`);
    }
    if (opts.correlationId)
      filters.push(eq(tasks.correlationId, opts.correlationId));
    if (opts.diaryId) filters.push(eq(tasks.diaryId, opts.diaryId));
    if (opts.proposedByAgentId) {
      filters.push(eq(tasks.proposedByAgentId, opts.proposedByAgentId));
    }
    if (opts.proposedByHumanId) {
      filters.push(eq(tasks.proposedByHumanId, opts.proposedByHumanId));
    }
    if (opts.claimedByAgentId) {
      filters.push(sql`
        exists (
          select 1
          from ${taskAttempts}
          where ${taskAttempts.taskId} = ${tasks.id}
            and ${taskAttempts.claimedByAgentId} = ${opts.claimedByAgentId}
        )
      `);
    }
    if (opts.hasAttempts === true) {
      filters.push(sql`
        exists (
          select 1
          from ${taskAttempts}
          where ${taskAttempts.taskId} = ${tasks.id}
        )
      `);
    } else if (opts.hasAttempts === false) {
      filters.push(sql`
        not exists (
          select 1
          from ${taskAttempts}
          where ${taskAttempts.taskId} = ${tasks.id}
        )
      `);
    }
    if (opts.queuedAfter) filters.push(gte(tasks.queuedAt, opts.queuedAfter));
    if (opts.queuedBefore) filters.push(lt(tasks.queuedAt, opts.queuedBefore));
    if (opts.completedAfter) {
      filters.push(gte(tasks.completedAt, opts.completedAfter));
    }
    if (opts.completedBefore) {
      filters.push(lt(tasks.completedAt, opts.completedBefore));
    }
    return filters;
  }

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

    async findByIds(ids: string[]): Promise<Task[]> {
      if (ids.length === 0) return [];
      return getExecutor(db).select().from(tasks).where(inArray(tasks.id, ids));
    },

    async findSealedTaskIds(ids: string[]): Promise<string[]> {
      if (ids.length === 0) return [];
      const rows = await getExecutor(db)
        .select({ taskId: correlationSeals.sealedByTaskId })
        .from(correlationSeals)
        .where(inArray(correlationSeals.sealedByTaskId, ids));
      return rows.map((row) => row.taskId);
    },

    async deleteCorrelationSealsForTasks(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      await getExecutor(db)
        .delete(correlationSeals)
        .where(inArray(correlationSeals.sealedByTaskId, ids));
    },

    async deleteMany(ids: string[]): Promise<string[]> {
      if (ids.length === 0) return [];
      const deleted = await getExecutor(db)
        .delete(tasks)
        .where(inArray(tasks.id, ids))
        .returning({ id: tasks.id });
      return deleted.map((row) => row.id);
    },

    async listExpiredNonTerminalTasks(
      now: Date,
      limit: number,
    ): Promise<Task[]> {
      return getExecutor(db)
        .select()
        .from(tasks)
        .where(
          and(
            notInArray(tasks.status, [
              'dispatched',
              'running',
              'completed',
              'failed',
              'cancelled',
              'expired',
            ]),
            lte(tasks.expiresAt, now),
          ),
        )
        .orderBy(asc(tasks.expiresAt))
        .limit(limit);
    },

    async expireIfStillNonTerminal(id: string): Promise<Task | null> {
      const [row] = await getExecutor(db)
        .update(tasks)
        .set({
          status: 'expired',
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(tasks.id, id), inArray(tasks.status, ['waiting', 'queued'])),
        )
        .returning();
      return row ?? null;
    },

    async expireManyIfStillNonTerminal(ids: string[]): Promise<Task[]> {
      if (ids.length === 0) return [];
      return getExecutor(db)
        .update(tasks)
        .set({
          status: 'expired',
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            inArray(tasks.id, [...new Set(ids)]),
            inArray(tasks.status, ['waiting', 'queued']),
          ),
        )
        .returning();
    },

    async listTerminalTasksPastRetention(
      cutoffs: TaskRetentionCutoffs,
      limit: number,
    ): Promise<Task[]> {
      return getExecutor(db)
        .select()
        .from(tasks)
        .where(
          or(
            and(
              eq(tasks.status, 'completed'),
              lte(tasks.completedAt, cutoffs.completedBefore),
            ),
            and(
              eq(tasks.status, 'failed'),
              lte(tasks.completedAt, cutoffs.failedBefore),
            ),
            and(
              eq(tasks.status, 'cancelled'),
              lte(tasks.completedAt, cutoffs.cancelledBefore),
            ),
            and(
              eq(tasks.status, 'expired'),
              lte(tasks.completedAt, cutoffs.expiredBefore),
            ),
          ),
        )
        .orderBy(asc(tasks.completedAt))
        .limit(limit);
    },

    async updateMetadata(
      id: string,
      metadata: { title?: string | null; tags?: string[] },
    ): Promise<Task | null> {
      const patch: Partial<Pick<NewTask, 'title' | 'tags'>> = {};
      if ('title' in metadata) patch.title = metadata.title ?? null;
      if ('tags' in metadata) patch.tags = metadata.tags;
      const [row] = await getExecutor(db)
        .update(tasks)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(tasks.id, id))
        .returning();
      return row ?? null;
    },

    /**
     * Find all tasks sharing a `correlation_id`. Used by async
     * validators (#1096) to inspect related runs or judges in the
     * same correlation group. No team or visibility filter — the
     * caller (task service) runs the permission check separately.
     * Returns the bare rows.
     */
    async findByCorrelationId(correlationId: string): Promise<Task[]> {
      return getExecutor(db)
        .select()
        .from(tasks)
        .where(eq(tasks.correlationId, correlationId));
    },

    async acquireTaskCreateGuardLock(lockKey: string): Promise<void> {
      if (!hasActiveTransaction()) {
        throw new Error(
          'acquireTaskCreateGuardLock must be called inside a TransactionRunner-managed transaction; pg_advisory_xact_lock has no effect outside one',
        );
      }
      await getExecutor(db).execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0::bigint))`,
      );
    },

    /**
     * Try to acquire a non-blocking transaction advisory lock keyed on
     * (continuationParentTaskId, continuationParentAttemptN). Returns true
     * if acquired, false if another transaction already holds it.
     *
     * Non-blocking by design (`pg_try_advisory_xact_lock`): the caller
     * (the daemon claim transaction) treats `false` as "another daemon
     * got there first; leave the task queued for the next poll cycle."
     * Auto-released on commit/rollback.
     *
     * NB: this is the first non-blocking advisory lock in the codebase.
     * The other advisory locks (correlation-seal, task-create guard,
     * task-messages append) use the blocking `pg_advisory_xact_lock`
     * because their concurrent-access path does want to serialize. Here
     * we want races to back off, not queue inside Postgres — only one
     * daemon can claim a continuation of a given parent attempt at a
     * time, and losers should retry on the next poll rather than wait.
     */
    async tryAcquireContinuationLock(
      parentTaskId: string,
      parentAttemptN: number,
    ): Promise<boolean> {
      if (!hasActiveTransaction()) {
        throw new Error(
          'tryAcquireContinuationLock must be called inside a TransactionRunner-managed transaction; pg_try_advisory_xact_lock has no effect outside one',
        );
      }
      const key = `continueFrom:${parentTaskId}:${parentAttemptN}`;
      const result = await getExecutor(db).execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}::text, 0::bigint)) AS acquired`,
      );
      const row = result.rows[0] as { acquired?: boolean } | undefined;
      return Boolean(row?.acquired);
    },

    async findActiveTaskByInputMatch(args: {
      taskType: string;
      inputMatches: ReadonlyArray<{
        path: readonly string[];
        value: string | number | boolean;
      }>;
      excludeTaskId?: string;
    }): Promise<Task | null> {
      const filters: SQL[] = [
        eq(tasks.taskType, args.taskType),
        notInArray(tasks.status, ['failed', 'cancelled', 'expired']),
      ];
      for (const match of args.inputMatches) {
        let expr = sql`${tasks.input}`;
        for (let i = 0; i < match.path.length - 1; i += 1) {
          expr = sql`${expr} -> ${match.path[i]}`;
        }
        const textExpr = sql`${expr} ->> ${match.path[match.path.length - 1]}`;
        if (typeof match.value === 'number') {
          filters.push(sql`(${textExpr})::numeric = ${match.value}`);
        } else if (typeof match.value === 'boolean') {
          filters.push(sql`(${textExpr})::boolean = ${match.value}`);
        } else {
          filters.push(sql`${textExpr} = ${match.value}`);
        }
      }
      if (args.excludeTaskId) {
        filters.push(sql`${tasks.id} <> ${args.excludeTaskId}::uuid`);
      }
      const [row] = await getExecutor(db)
        .select()
        .from(tasks)
        .where(and(...filters))
        .orderBy(desc(tasks.createdAt))
        .limit(1);
      return row ?? null;
    },

    async list(opts: {
      teamId: string;
      status?: Task['status'];
      statuses?: Task['status'][];
      query?: string;
      taskTypes?: string[];
      tags?: string[];
      excludeTags?: string[];
      correlationId?: string;
      diaryId?: string;
      proposedByAgentId?: string;
      proposedByHumanId?: string;
      claimedByAgentId?: string;
      hasAttempts?: boolean;
      queuedAfter?: Date;
      queuedBefore?: Date;
      completedAfter?: Date;
      completedBefore?: Date;
      limit?: number;
      cursor?: string;
    }): Promise<{ items: Task[]; nextCursor?: string }> {
      const limit = Math.min(opts.limit ?? PAGE_SIZE, PAGE_SIZE);
      const filters = buildListFilters(opts);
      // Cursor is pagination-only — it must NOT be applied to count queries.
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

    /** Total rows matching the same filters as `list` (ignores cursor/limit). */
    async count(opts: TaskListFilterOpts): Promise<number> {
      const [row] = await getExecutor(db)
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(...buildListFilters(opts)));
      return row?.count ?? 0;
    },

    async claimIfQueued(id: string): Promise<Task | null> {
      const [row] = await getExecutor(db)
        .update(tasks)
        .set({ status: 'dispatched', updatedAt: sql`now()` })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.status, 'queued'),
            or(isNull(tasks.expiresAt), gt(tasks.expiresAt, sql`now()`)),
          ),
        )
        .returning();
      return row ?? null;
    },

    async listWaitingTasks(): Promise<Task[]> {
      return getExecutor(db)
        .select()
        .from(tasks)
        .where(eq(tasks.status, 'waiting'));
    },

    async listWaitingTasksReferencingTask(taskId: string): Promise<Task[]> {
      return getExecutor(db)
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.status, 'waiting'),
            sql`jsonb_path_exists(${tasks.claimCondition}, '$.** ? (@.taskId == $taskId)', jsonb_build_object('taskId', ${taskId}::text))`,
          ),
        );
    },

    async promoteWaitingTasks(ids: string[]): Promise<Task[]> {
      if (ids.length === 0) return [];
      return getExecutor(db)
        .update(tasks)
        .set({ status: 'queued', queuedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(inArray(tasks.id, ids), eq(tasks.status, 'waiting')))
        .returning();
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

    /**
     * Conditional status update: only writes if the current status is NOT in
     * `excluded`. Returns the updated row, or `null` if the row was already
     * in an excluded state (race lost — caller should re-read).
     *
     * Used by heartbeat / first-heartbeat to avoid clobbering a `cancelled`
     * row back to `running` when a cancel commits in the narrow window
     * between the heartbeat reading the row and writing it (#938).
     */
    async updateStatusIfNotIn(
      id: string,
      status: Task['status'],
      excluded: Task['status'][],
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
        .where(and(eq(tasks.id, id), notInArray(tasks.status, excluded)))
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

    async upsertExecutorManifest(
      input: NewExecutorManifest,
    ): Promise<ExecutorManifest> {
      const [row] = await getExecutor(db)
        .insert(executorManifests)
        .values(input)
        .onConflictDoNothing()
        .returning();
      if (row) return row;

      const [existing] = await getExecutor(db)
        .select()
        .from(executorManifests)
        .where(eq(executorManifests.fingerprint, input.fingerprint))
        .limit(1);
      if (!existing) {
        throw new Error('executor manifest upsert failed');
      }
      return existing;
    },

    async findExecutorManifest(
      fingerprint: string,
    ): Promise<ExecutorManifest | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(executorManifests)
        .where(eq(executorManifests.fingerprint, fingerprint))
        .limit(1);
      return row ?? null;
    },

    async upsertExecutorManifestVerification(
      input: NewExecutorManifestVerification,
    ): Promise<ExecutorManifestVerification> {
      const [row] = await getExecutor(db)
        .insert(executorManifestVerifications)
        .values(input)
        .onConflictDoUpdate({
          target: [
            executorManifestVerifications.fingerprint,
            executorManifestVerifications.trustLevel,
          ],
          set: {
            status: input.status,
            evidence: input.evidence,
            verifiedAt: input.verifiedAt ?? new Date(),
          },
        })
        .returning();
      return row;
    },

    async findExecutorManifestVerification(
      fingerprint: string,
      trustLevel: ExecutorManifestVerification['trustLevel'],
    ): Promise<ExecutorManifestVerification | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(executorManifestVerifications)
        .where(
          and(
            eq(executorManifestVerifications.fingerprint, fingerprint),
            eq(executorManifestVerifications.trustLevel, trustLevel),
          ),
        )
        .limit(1);
      return row ?? null;
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

    async findAttemptWithManifests(
      taskId: string,
      attemptN: number,
    ): Promise<TaskAttemptWithManifests | null> {
      const [row] = await getExecutor(db)
        .select({
          attempt: taskAttempts,
          claimedManifest: claimedManifest.manifest,
          completedManifest: completedManifest.manifest,
        })
        .from(taskAttempts)
        .leftJoin(
          claimedManifest,
          eq(
            taskAttempts.claimedExecutorFingerprint,
            claimedManifest.fingerprint,
          ),
        )
        .leftJoin(
          completedManifest,
          eq(
            taskAttempts.completedExecutorFingerprint,
            completedManifest.fingerprint,
          ),
        )
        .where(
          and(
            eq(taskAttempts.taskId, taskId),
            eq(taskAttempts.attemptN, attemptN),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        ...row.attempt,
        claimedExecutorManifest: row.claimedManifest ?? null,
        completedExecutorManifest: row.completedManifest ?? null,
      };
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
          | 'claimedExecutorFingerprint'
          | 'completedExecutorFingerprint'
          | 'error'
          | 'usage'
          | 'contentSignature'
          | 'signedAt'
          | 'daemonState'
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

    async listAttempts(taskId: string): Promise<TaskAttemptWithManifests[]> {
      const rows = await getExecutor(db)
        .select({
          attempt: taskAttempts,
          claimedManifest: claimedManifest.manifest,
          completedManifest: completedManifest.manifest,
        })
        .from(taskAttempts)
        .leftJoin(
          claimedManifest,
          eq(
            taskAttempts.claimedExecutorFingerprint,
            claimedManifest.fingerprint,
          ),
        )
        .leftJoin(
          completedManifest,
          eq(
            taskAttempts.completedExecutorFingerprint,
            completedManifest.fingerprint,
          ),
        )
        .where(eq(taskAttempts.taskId, taskId))
        .orderBy(asc(taskAttempts.attemptN));
      return rows.map((row) => ({
        ...row.attempt,
        claimedExecutorManifest: row.claimedManifest ?? null,
        completedExecutorManifest: row.completedManifest ?? null,
      }));
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

    /**
     * Find tasks whose claim_expires_at is older than `staleSince` and are
     * still in a non-terminal claim state (`dispatched` or `running`).
     * Used by the orphan-recovery sweeper (#937) to detect tasks abandoned
     * by a dead DBOS workflow process — the in-workflow recv loop is the
     * source of truth for liveness while the workflow is alive, but the
     * row-level claim_expires_at is the only signal once the workflow
     * itself dies.
     *
     * Returns the task plus the active (non-terminal) attempt — there is
     * always exactly one such attempt while the task is dispatched/running.
     */
    async listOrphanedTasks(
      staleSince: Date,
      limit: number,
    ): Promise<
      Array<{
        task: Task;
        attempt: TaskAttempt;
      }>
    > {
      const rows = await getExecutor(db)
        .select({ task: tasks, attempt: taskAttempts })
        .from(tasks)
        .innerJoin(taskAttempts, eq(taskAttempts.taskId, tasks.id))
        .where(
          and(
            inArray(tasks.status, ['dispatched', 'running']),
            inArray(taskAttempts.status, ['claimed', 'running']),
            lt(tasks.claimExpiresAt, staleSince),
          ),
        )
        .orderBy(asc(tasks.claimExpiresAt))
        .limit(limit);
      return rows;
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
      // Seq numbers must be dense and monotonic per (task_id, attempt_n).
      // The naive `INSERT ... SELECT MAX(seq) + ROW_NUMBER()` pattern races
      // under READ COMMITTED: two concurrent statements both observe the
      // same MAX(seq) (they can't see each other's uncommitted rows) and
      // both compute the same seq range, colliding on the primary key
      // (task_id, attempt_n, seq).
      //
      // Strategy: take a transactional advisory lock scoped to the
      // (task_id, attempt_n) pair. The lock auto-releases on commit/rollback,
      // serialises only writers for this specific attempt, and leaves
      // readers and other tasks/attempts unaffected. See entry
      // 6973382c-202a-4659-b148-345601ff6e84 for the same pattern used on
      // createDiaryGrant.
      const taskId = messages[0].taskId;
      const attemptN = messages[0].attemptN;

      // Build the VALUES rows for the inline table: (kind, payload, timestamp)
      const valuesTuples = messages
        .map(
          (m) =>
            sql`(${m.kind}::task_message_kind, ${JSON.stringify(m.payload)}::jsonb, ${m.timestamp ?? new Date()}::timestamptz)`,
        )
        .reduce((acc, cur) => sql`${acc}, ${cur}`);

      // hashtextextended(text, bigint) → bigint gives a stable signed int64
      // derived from (task_id, attempt_n). Postgres only exposes the
      // single-arg bigint overload of pg_advisory_xact_lock (the two-arg
      // form is int4 + int4, too narrow), so we fold attempt_n into the
      // hash's second argument. Different attempts of the same task get
      // disjoint lock keys and do NOT contend with each other.
      const lockAndInsert = async (exec: Database) => {
        await exec.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${taskId}::text, ${attemptN}::bigint))`,
        );
        await exec.execute(sql`
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
      };

      // pg_advisory_xact_lock needs a transaction so the lock auto-releases
      // on commit/rollback. If an outer TransactionRunner-managed tx is
      // already active (DBOS or Drizzle), ride it — its executor is stored
      // in AsyncLocalStorage and getExecutor(db) returns the tx client.
      // Otherwise open a fresh db.transaction so the lock has a tx to attach
      // to and doesn't leak past the statement.
      if (hasActiveTransaction()) {
        await lockAndInsert(getExecutor(db));
      } else {
        await db.transaction((tx) => lockAndInsert(tx as unknown as Database));
      }
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

    async recomputeAttemptActivityStats(
      taskId: string,
      attemptN: number,
    ): Promise<TaskAttemptActivityStats> {
      const messages = await getExecutor(db)
        .select()
        .from(taskMessages)
        .where(
          and(
            eq(taskMessages.taskId, taskId),
            eq(taskMessages.attemptN, attemptN),
          ),
        )
        .orderBy(asc(taskMessages.seq));
      const values = deriveAttemptActivityStats(taskId, attemptN, messages);
      const [row] = await getExecutor(db)
        .insert(taskAttemptActivityStats)
        .values(values)
        .onConflictDoUpdate({
          target: [
            taskAttemptActivityStats.taskId,
            taskAttemptActivityStats.attemptN,
          ],
          set: {
            computedAt: values.computedAt,
            entryGetCount: values.entryGetCount,
            entrySearchCount: values.entrySearchCount,
            failedToolCallCount: values.failedToolCallCount,
            knowledgeToolCallCount: values.knowledgeToolCallCount,
            messageCount: values.messageCount,
            packGetCount: values.packGetCount,
            sourceLastSeq: values.sourceLastSeq,
            toolCallCount: values.toolCallCount,
            turnCount: values.turnCount,
          },
        })
        .returning();
      if (!row) {
        throw new Error('failed to upsert task attempt activity stats');
      }
      return row;
    },

    async listMissingAttemptActivityStats(
      filter: TaskActivityAnalyticsFilter,
      limit = 500,
    ): Promise<Array<{ taskId: string; attemptN: number }>> {
      const rows = await queryActivityAttemptRows(db, filter, true, limit);
      return rows.map((row) => ({
        taskId: row.taskId,
        attemptN: row.attemptN,
      }));
    },

    async getTaskActivityAnalytics(
      filter: TaskActivityAnalyticsFilter,
    ): Promise<TaskActivityAnalyticsResult> {
      const recomputeLimit = 500;
      const missing = await this.listMissingAttemptActivityStats(
        filter,
        recomputeLimit,
      );
      for (const attempt of missing) {
        await this.recomputeAttemptActivityStats(
          attempt.taskId,
          attempt.attemptN,
        );
      }
      const rows = await queryActivityAttemptRows(db, filter, false);
      return buildActivityAnalytics(rows, filter.groupBy ?? 'none', {
        statsComplete: missing.length < recomputeLimit,
      });
    },
  };
}

function deriveAttemptActivityStats(
  taskId: string,
  attemptN: number,
  messages: TaskMessage[],
): NewTaskAttemptActivityStats {
  const counts = {
    entryGetCount: 0,
    entrySearchCount: 0,
    failedToolCallCount: 0,
    knowledgeToolCallCount: 0,
    messageCount: messages.length,
    packGetCount: 0,
    toolCallCount: 0,
    turnCount: 0,
  };
  let sourceLastSeq = -1;
  for (const message of messages) {
    sourceLastSeq = Math.max(sourceLastSeq, Number(message.seq));
    if (message.kind === 'turn_end') counts.turnCount += 1;
    if (message.kind === 'tool_call_start') {
      counts.toolCallCount += 1;
      const toolName = getToolName(message.payload);
      const kind = classifyKnowledgeTool(toolName);
      if (kind) counts.knowledgeToolCallCount += 1;
      if (kind === 'entry_search') counts.entrySearchCount += 1;
      if (kind === 'entry_get') counts.entryGetCount += 1;
      if (kind === 'pack_get') counts.packGetCount += 1;
    }
    if (
      message.kind === 'tool_call_end' &&
      isRecord(message.payload) &&
      message.payload.is_error === true
    ) {
      counts.failedToolCallCount += 1;
    }
  }
  return {
    ...counts,
    attemptN,
    computedAt: new Date(),
    sourceLastSeq,
    taskId,
  };
}

function getToolName(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const value = payload.tool_name ?? payload.name ?? payload.tool;
  return typeof value === 'string' ? value : null;
}

function classifyKnowledgeTool(
  toolName: string | null,
): 'entry_search' | 'entry_get' | 'pack_get' | null {
  if (!toolName) return null;
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (
    normalized.includes('entry_search') ||
    normalized.includes('entries_search') ||
    normalized.includes('diary_search')
  ) {
    return 'entry_search';
  }
  if (
    normalized.includes('entry_get') ||
    normalized.includes('entries_get') ||
    normalized.includes('diary_entry_get')
  ) {
    return 'entry_get';
  }
  if (
    normalized.includes('pack_get') ||
    normalized.includes('packs_get') ||
    normalized.includes('rendered_pack_get') ||
    normalized.includes('rendered_packs_get')
  ) {
    return 'pack_get';
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapActivityAttemptRow(row: unknown): TaskActivityAttemptRow {
  const r = row as Record<string, unknown>;
  const stats =
    r.statsTaskId === null
      ? null
      : ({
          attemptN: Number(r.statsAttemptN),
          computedAt: coerceDate(r.statsComputedAt),
          entryGetCount: Number(r.entryGetCount ?? 0),
          entrySearchCount: Number(r.entrySearchCount ?? 0),
          failedToolCallCount: Number(r.failedToolCallCount ?? 0),
          knowledgeToolCallCount: Number(r.knowledgeToolCallCount ?? 0),
          messageCount: Number(r.messageCount ?? 0),
          packGetCount: Number(r.packGetCount ?? 0),
          sourceLastSeq: Number(r.sourceLastSeq ?? -1),
          taskId: String(r.statsTaskId),
          toolCallCount: Number(r.toolCallCount ?? 0),
          turnCount: Number(r.turnCount ?? 0),
        } satisfies TaskAttemptActivityStats);
  return {
    acceptedAttemptN:
      r.acceptedAttemptN === null ? null : Number(r.acceptedAttemptN),
    attemptCompletedAt: coerceNullableDate(r.attemptCompletedAt),
    attemptN: Number(r.attemptN),
    attemptStatus: String(r.attemptStatus) as TaskAttempt['status'],
    claimedByAgentId: String(r.claimedByAgentId),
    diaryId: r.diaryId === null ? null : String(r.diaryId),
    model: r.model === null ? null : String(r.model),
    profileId: r.profileId === null ? null : String(r.profileId),
    provider: r.provider === null ? null : String(r.provider),
    stats,
    taskCompletedAt: coerceNullableDate(r.taskCompletedAt),
    taskId: String(r.taskId),
    taskQueuedAt: coerceDate(r.taskQueuedAt),
    taskStatus: String(r.taskStatus) as Task['status'],
    taskTags: Array.isArray(r.taskTags) ? r.taskTags.map(String) : [],
    taskType: String(r.taskType),
    usage: r.usage,
  };
}

function coerceNullableDate(value: unknown): Date | null {
  return value === null ? null : coerceDate(value);
}

function coerceDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function emptyMetricBucket(): TaskActivityMetricBucket {
  return {
    abortedAttemptCount: 0,
    acceptedAttemptCount: 0,
    acceptedTaskCount: 0,
    attemptCount: 0,
    cancelledAttemptCount: 0,
    entryGetCount: 0,
    entrySearchCount: 0,
    extraAttemptCount: 0,
    extraTokensBeforeAcceptance: 0,
    failedAttemptCount: 0,
    failedToolCallCount: 0,
    firstAttemptAcceptedTaskCount: 0,
    highFrictionAttemptCount: 0,
    knowledgeToolCallCount: 0,
    medianTimeToAcceptedMs: null,
    medianToolCallsPerAttempt: null,
    medianTurnsPerAttempt: null,
    messageCount: 0,
    packGetCount: 0,
    retryAttemptCount: 0,
    retryRecoveredTaskCount: 0,
    taskCount: 0,
    terminalFailureTaskCount: 0,
    timeoutAttemptCount: 0,
    toolCallCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    turnCount: 0,
  };
}

function buildActivityAnalytics(
  rows: TaskActivityAttemptRow[],
  groupBy: TaskActivityGroupBy,
  options: { statsComplete: boolean },
): TaskActivityAnalyticsResult {
  return {
    groups:
      groupBy === 'none'
        ? []
        : buildActivityGroups(rows, groupBy).sort((a, b) =>
            a.key.localeCompare(b.key),
          ),
    overall: summarizeActivityRows(rows),
    statsComplete: options.statsComplete,
  };
}

function buildActivityGroups(
  rows: TaskActivityAttemptRow[],
  groupBy: Exclude<TaskActivityGroupBy, 'none'>,
): TaskActivityAnalyticsGroup[] {
  const grouped = new Map<string, TaskActivityAttemptRow[]>();
  for (const row of rows) {
    for (const group of groupKeys(row, groupBy)) {
      const existing = grouped.get(group.key) ?? [];
      existing.push(row);
      grouped.set(group.key, existing);
    }
  }
  return [...grouped.entries()].map(([key, groupRows]) => ({
    key,
    label: labelForGroup(key, groupBy, groupRows),
    metrics: summarizeActivityRows(groupRows),
  }));
}

function groupKeys(
  row: TaskActivityAttemptRow,
  groupBy: Exclude<TaskActivityGroupBy, 'none'>,
): Array<{ key: string }> {
  switch (groupBy) {
    case 'agent':
      return [{ key: row.claimedByAgentId }];
    case 'day':
      return [
        {
          key: (
            row.attemptCompletedAt ??
            row.taskCompletedAt ??
            row.taskQueuedAt
          )
            .toISOString()
            .slice(0, 10),
        },
      ];
    case 'diary':
      return [{ key: row.diaryId ?? 'unknown' }];
    case 'profile':
      return [{ key: row.profileId ?? 'unknown' }];
    case 'providerModel':
      return [
        { key: `${row.provider ?? 'unknown'}/${row.model ?? 'unknown'}` },
      ];
    case 'tag':
      return row.taskTags.length
        ? row.taskTags.map((tag) => ({ key: tag }))
        : [{ key: 'untagged' }];
    case 'taskType':
      return [{ key: row.taskType }];
  }
}

function labelForGroup(
  key: string,
  groupBy: Exclude<TaskActivityGroupBy, 'none'>,
  rows: TaskActivityAttemptRow[],
): string {
  if (groupBy === 'profile') {
    const row = rows.find((candidate) => candidate.profileId === key);
    if (row?.provider || row?.model) {
      return `${row.provider ?? 'unknown'}/${row.model ?? 'unknown'}`;
    }
  }
  return key;
}

function summarizeActivityRows(
  rows: TaskActivityAttemptRow[],
): TaskActivityMetricBucket {
  const bucket = emptyMetricBucket();
  const taskMap = new Map<string, TaskActivityAttemptRow[]>();
  const turns: number[] = [];
  const toolCalls: number[] = [];
  const timeToAcceptedMs: number[] = [];

  for (const row of rows) {
    const taskRows = taskMap.get(row.taskId) ?? [];
    taskRows.push(row);
    taskMap.set(row.taskId, taskRows);

    const stats = row.stats;
    const usage = readUsage(row.usage);
    const totalTokens = usage.inputTokens + usage.outputTokens;
    bucket.attemptCount += 1;
    bucket.messageCount += stats?.messageCount ?? 0;
    bucket.turnCount += stats?.turnCount ?? 0;
    bucket.toolCallCount += stats?.toolCallCount ?? 0;
    bucket.failedToolCallCount += stats?.failedToolCallCount ?? 0;
    bucket.knowledgeToolCallCount += stats?.knowledgeToolCallCount ?? 0;
    bucket.entrySearchCount += stats?.entrySearchCount ?? 0;
    bucket.entryGetCount += stats?.entryGetCount ?? 0;
    bucket.packGetCount += stats?.packGetCount ?? 0;
    bucket.totalInputTokens += usage.inputTokens;
    bucket.totalOutputTokens += usage.outputTokens;
    bucket.totalTokens += totalTokens;
    if (row.attemptStatus === 'completed') bucket.acceptedAttemptCount += 1;
    if (row.attemptStatus === 'failed') bucket.failedAttemptCount += 1;
    if (row.attemptStatus === 'timed_out') bucket.timeoutAttemptCount += 1;
    if (row.attemptStatus === 'aborted') bucket.abortedAttemptCount += 1;
    if (row.attemptStatus === 'cancelled') bucket.cancelledAttemptCount += 1;
    if (row.attemptN > 1) bucket.retryAttemptCount += 1;
    if (
      (stats?.turnCount ?? 0) >= 8 ||
      (stats?.failedToolCallCount ?? 0) >= 3
    ) {
      bucket.highFrictionAttemptCount += 1;
    }
    if (row.acceptedAttemptN !== null && row.attemptN < row.acceptedAttemptN) {
      bucket.extraAttemptCount += 1;
      bucket.extraTokensBeforeAcceptance += totalTokens;
    }
    if (stats) {
      turns.push(stats.turnCount);
      toolCalls.push(stats.toolCallCount);
    }
  }

  bucket.taskCount = taskMap.size;
  for (const taskRows of taskMap.values()) {
    const first = taskRows[0];
    if (!first) continue;
    const acceptedAttemptN = first.acceptedAttemptN;
    const acceptedRow =
      acceptedAttemptN === null
        ? undefined
        : taskRows.find((row) => row.attemptN === acceptedAttemptN);
    if (acceptedAttemptN !== null && acceptedRow) {
      bucket.acceptedTaskCount += 1;
      if (acceptedAttemptN === 1) bucket.firstAttemptAcceptedTaskCount += 1;
      if (acceptedAttemptN > 1) bucket.retryRecoveredTaskCount += 1;
      const completedAt =
        acceptedRow.attemptCompletedAt ?? first.taskCompletedAt ?? null;
      if (completedAt) {
        timeToAcceptedMs.push(
          Math.max(0, completedAt.getTime() - first.taskQueuedAt.getTime()),
        );
      }
    } else if (
      first.taskStatus === 'failed' ||
      first.taskStatus === 'cancelled' ||
      first.taskStatus === 'expired'
    ) {
      bucket.terminalFailureTaskCount += 1;
    }
  }

  bucket.medianTimeToAcceptedMs = median(timeToAcceptedMs);
  bucket.medianToolCallsPerAttempt = median(toolCalls);
  bucket.medianTurnsPerAttempt = median(turns);
  return bucket;
}

function readUsage(usage: unknown): {
  inputTokens: number;
  outputTokens: number;
} {
  if (!isRecord(usage)) return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: readNonNegativeNumber(usage.inputTokens),
    outputTokens: readNonNegativeNumber(usage.outputTokens),
  };
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
  return Number.isFinite(value) ? value : null;
}

function terminalAttemptStatuses(): TaskAttempt['status'][] {
  return ['completed', 'failed', 'cancelled', 'aborted', 'timed_out'];
}

function buildActivityFilters(filter: TaskActivityAnalyticsFilter): SQL[] {
  const filters: SQL[] = [
    eq(tasks.teamId, filter.teamId),
    inArray(taskAttempts.status, terminalAttemptStatuses()),
    gte(taskAttempts.completedAt, filter.completedAfter),
    lt(taskAttempts.completedAt, filter.completedBefore),
  ];
  const tags = normalizeList(filter.tags);
  if (tags.length > 0) {
    filters.push(
      sql`${tasks.tags} @> ARRAY[${sql.join(
        tags.map((tag) => sql`${tag}`),
        sql`,`,
      )}]::text[]`,
    );
  }
  const taskTypes = normalizeList(filter.taskTypes);
  if (taskTypes.length === 1) {
    filters.push(eq(tasks.taskType, taskTypes[0]));
  } else if (taskTypes.length > 1) {
    filters.push(inArray(tasks.taskType, taskTypes));
  }
  const diaryIds = normalizeList(filter.diaryIds);
  if (diaryIds.length === 1) {
    filters.push(eq(tasks.diaryId, diaryIds[0]));
  } else if (diaryIds.length > 1) {
    filters.push(inArray(tasks.diaryId, diaryIds));
  }
  const claimedByAgentIds = normalizeList(filter.claimedByAgentIds);
  if (claimedByAgentIds.length === 1) {
    filters.push(eq(taskAttempts.claimedByAgentId, claimedByAgentIds[0]));
  } else if (claimedByAgentIds.length > 1) {
    filters.push(inArray(taskAttempts.claimedByAgentId, claimedByAgentIds));
  }
  const profileIds = normalizeList(filter.profileIds);
  if (profileIds.length > 0) {
    const profileIdSql = sql.join(
      profileIds.map((profileId) => sql`${profileId}::uuid`),
      sql`,`,
    );
    filters.push(sql`
      (
        ${runtimeSessions.sourceRuntimeProfileId} IN (${profileIdSql})
        OR latest_slot.runtime_profile_id IN (${profileIdSql})
      )
    `);
  }
  return filters;
}

async function queryActivityAttemptRows(
  db: Database,
  filter: TaskActivityAnalyticsFilter,
  missingOnly: boolean,
  limit?: number,
): Promise<TaskActivityAttemptRow[]> {
  const filters = buildActivityFilters(filter);
  if (missingOnly) filters.push(isNull(taskAttemptActivityStats.taskId));
  const limitSql = limit ? sql`LIMIT ${limit}` : sql``;
  const result = await getExecutor(db).execute(sql`
    SELECT
      ${tasks.id} AS "taskId",
      ${tasks.taskType} AS "taskType",
      ${tasks.tags} AS "taskTags",
      ${tasks.diaryId} AS "diaryId",
      ${tasks.status} AS "taskStatus",
      ${tasks.acceptedAttemptN} AS "acceptedAttemptN",
      ${tasks.queuedAt} AS "taskQueuedAt",
      ${tasks.completedAt} AS "taskCompletedAt",
      ${taskAttempts.attemptN} AS "attemptN",
      ${taskAttempts.status} AS "attemptStatus",
      ${taskAttempts.completedAt} AS "attemptCompletedAt",
      ${taskAttempts.claimedByAgentId} AS "claimedByAgentId",
      ${taskAttempts.usage} AS "usage",
      COALESCE(${runtimeSessions.sourceRuntimeProfileId}, latest_slot.runtime_profile_id) AS "profileId",
      COALESCE(${taskAttempts.usage}->>'provider', ${runtimeProfiles.provider}, latest_slot.provider) AS "provider",
      COALESCE(${taskAttempts.usage}->>'model', ${runtimeProfiles.model}, latest_slot.model) AS "model",
      ${taskAttemptActivityStats.taskId} AS "statsTaskId",
      ${taskAttemptActivityStats.attemptN} AS "statsAttemptN",
      ${taskAttemptActivityStats.computedAt} AS "statsComputedAt",
      ${taskAttemptActivityStats.sourceLastSeq} AS "sourceLastSeq",
      ${taskAttemptActivityStats.messageCount} AS "messageCount",
      ${taskAttemptActivityStats.turnCount} AS "turnCount",
      ${taskAttemptActivityStats.toolCallCount} AS "toolCallCount",
      ${taskAttemptActivityStats.failedToolCallCount} AS "failedToolCallCount",
      ${taskAttemptActivityStats.knowledgeToolCallCount} AS "knowledgeToolCallCount",
      ${taskAttemptActivityStats.entrySearchCount} AS "entrySearchCount",
      ${taskAttemptActivityStats.entryGetCount} AS "entryGetCount",
      ${taskAttemptActivityStats.packGetCount} AS "packGetCount"
    FROM ${taskAttempts}
    INNER JOIN ${tasks} ON ${tasks.id} = ${taskAttempts.taskId}
    LEFT JOIN ${taskAttemptActivityStats}
      ON ${taskAttemptActivityStats.taskId} = ${taskAttempts.taskId}
      AND ${taskAttemptActivityStats.attemptN} = ${taskAttempts.attemptN}
    LEFT JOIN ${runtimeSessions}
      ON ${runtimeSessions.teamId} = ${tasks.teamId}
      AND ${runtimeSessions.taskId} = ${taskAttempts.taskId}
      AND ${runtimeSessions.attemptN} = ${taskAttempts.attemptN}
      AND ${runtimeSessions.deletedAt} IS NULL
    LEFT JOIN LATERAL (
      SELECT
        ${runtimeSlots.runtimeProfileId} AS runtime_profile_id,
        ${runtimeSlots.provider} AS provider,
        ${runtimeSlots.model} AS model
      FROM ${runtimeSlots}
      WHERE ${runtimeSlots.teamId} = ${tasks.teamId}
        AND ${runtimeSlots.lastTaskId} = ${taskAttempts.taskId}
        AND ${runtimeSlots.lastAttemptN} = ${taskAttempts.attemptN}
      ORDER BY ${runtimeSlots.lastUsedAtMs} DESC
      LIMIT 1
    ) latest_slot ON TRUE
    LEFT JOIN ${runtimeProfiles}
      ON ${runtimeProfiles.id} = COALESCE(${runtimeSessions.sourceRuntimeProfileId}, latest_slot.runtime_profile_id)
    WHERE ${and(...filters)}
    ORDER BY ${taskAttempts.completedAt} DESC
    ${limitSql}
  `);
  return result.rows.map((row) => mapActivityAttemptRow(row));
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function looksLikeUuidPrefix(value: string): boolean {
  return /^[0-9a-f]{1,8}(?:-[0-9a-f]{0,4}(?:-[0-9a-f]{0,4}(?:-[0-9a-f]{0,4}(?:-[0-9a-f]{0,12})?)?)?)?$/i.test(
    value,
  );
}

function normalizeList(values: string[] | undefined): string[] {
  return values?.map((value) => value.trim()).filter(Boolean) ?? [];
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
