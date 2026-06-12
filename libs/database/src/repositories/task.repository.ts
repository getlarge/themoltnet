import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  notInArray,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '../db.js';
import {
  type ExecutorManifest,
  executorManifests,
  type ExecutorManifestVerification,
  executorManifestVerifications,
  type NewExecutorManifest,
  type NewExecutorManifestVerification,
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
  executorProvider?: string;
  executorModel?: string;
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
    if (opts.executorProvider && opts.executorModel) {
      // Either no restriction set, or our pair is one of the allowed
      // executors. JSONB containment (`@>`) is index-friendly with a GIN index
      // on `allowed_executors`. The pair is bound as a text parameter and cast
      // to jsonb to keep the path injection-safe.
      const pairJson = JSON.stringify([
        { provider: opts.executorProvider, model: opts.executorModel },
      ]);
      filters.push(sql`(
        ${tasks.allowedExecutors} = '[]'::jsonb
        OR ${tasks.allowedExecutors} @> ${pairJson}::jsonb
      )`);
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
      // When both are provided, filter the result to tasks that either
      // have an empty `allowed_executors` array (no restriction) or
      // include this exact `(provider, model)` pair. Both are expected
      // to be lowercased upstream (route handler).
      executorProvider?: string;
      executorModel?: string;
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
        .where(and(eq(tasks.id, id), eq(tasks.status, 'queued')))
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
  };
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
