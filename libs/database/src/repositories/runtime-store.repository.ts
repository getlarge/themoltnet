import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  runtimeConversationHeads,
  runtimeConversationRecords,
  type RuntimeStore,
  runtimeStoreAttempts,
  type RuntimeStoreCommit,
  runtimeStoreCommits,
  runtimeStores,
  taskAttempts,
  tasks,
} from '../schema.js';
import { getExecutor, hasActiveTransaction } from '../transaction-context.js';

export interface RuntimeStoreAuthority {
  teamId: string;
  taskId: string;
  attemptN: number;
  agentId: string;
  leaseId: string;
  executorFingerprint: string;
}

export function createRuntimeStoreRepository(db: Database) {
  const transactionRequired = () => {
    if (!hasActiveTransaction())
      throw new Error('Runtime store mutation requires a transaction');
  };
  const records = runtimeConversationRecords;
  return {
    async conversationHead(storeId: string) {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeConversationHeads)
        .where(eq(runtimeConversationHeads.storeId, storeId));
      return row?.seq ?? 0;
    },
    async saveConversationRecords(
      storeId: string,
      seq: number,
      rows: Omit<typeof records.$inferInsert, 'storeId' | 'seq'>[],
    ) {
      transactionRequired();
      if (rows.length)
        await getExecutor(db)
          .insert(records)
          .values(rows.map((row) => ({ ...row, storeId, seq })));
      await getExecutor(db)
        .insert(runtimeConversationHeads)
        .values({ storeId, seq })
        .onConflictDoUpdate({
          target: runtimeConversationHeads.storeId,
          set: { seq },
        });
    },
    async conversationRecord(
      storeId: string,
      type: string,
      id: number,
      throughSeq: number,
    ) {
      const [row] = await getExecutor(db)
        .select()
        .from(records)
        .where(
          and(
            eq(records.storeId, storeId),
            eq(records.type, type),
            eq(records.id, id),
            lte(records.seq, throughSeq),
          ),
        )
        .orderBy(desc(records.seq))
        .limit(1);
      return row;
    },
    async conversationDocument(
      storeId: string,
      address: string,
      throughSeq: number,
    ) {
      // Retiring and recreating an address can happen in the same commit;
      // prefer its new live incarnation, regardless of allocation order.
      const [row] = await getExecutor(db)
        .select()
        .from(records)
        .where(
          and(
            eq(records.storeId, storeId),
            eq(records.address, address),
            lte(records.seq, throughSeq),
          ),
        )
        .orderBy(
          desc(records.seq),
          sql`CASE WHEN ${records.value}->>'retired' = 'true' THEN 1 ELSE 0 END`,
          desc(records.id),
        )
        .limit(1);
      return row;
    },
    async conversationList(storeId: string, throughSeq: number) {
      return getExecutor(db)
        .select()
        .from(records)
        .where(
          and(
            eq(records.storeId, storeId),
            eq(records.type, 'conversation'),
            lte(records.seq, throughSeq),
          ),
        )
        .orderBy(asc(records.id))
        .limit(1025);
    },
    async conversationEntries(
      storeId: string,
      conversationId: number,
      throughSeq: number,
      maxId: number,
      limit: number,
    ) {
      return getExecutor(db)
        .select()
        .from(records)
        .where(
          and(
            eq(records.storeId, storeId),
            eq(records.type, 'entry'),
            eq(records.conversationId, conversationId),
            lte(records.seq, throughSeq),
            lte(records.id, maxId),
          ),
        )
        .orderBy(desc(records.id))
        .limit(limit);
    },
    async lockAuthority(input: RuntimeStoreAuthority) {
      transactionRequired();
      // A joined locking SELECT alone lets the query plan choose lock order.
      // Lifecycle writes lock task then attempt; fence the task first here too.
      const [task] = await getExecutor(db)
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, input.taskId), eq(tasks.teamId, input.teamId)))
        .for('no key update');
      if (!task) return null;
      const [row] = await getExecutor(db)
        .select({ task: tasks, attempt: taskAttempts })
        .from(tasks)
        .innerJoin(
          taskAttempts,
          and(
            eq(taskAttempts.taskId, tasks.id),
            eq(taskAttempts.attemptN, input.attemptN),
          ),
        )
        .where(
          and(
            eq(tasks.id, input.taskId),
            eq(tasks.teamId, input.teamId),
            eq(tasks.claimAgentId, input.agentId),
            eq(taskAttempts.claimedByAgentId, input.agentId),
            eq(taskAttempts.leaseId, input.leaseId),
            eq(
              taskAttempts.claimedExecutorFingerprint,
              input.executorFingerprint,
            ),
            inArray(tasks.status, ['dispatched', 'running']),
            inArray(taskAttempts.status, ['claimed', 'running']),
            gt(tasks.claimExpiresAt, sql`clock_timestamp()`),
            sql`NOT EXISTS (SELECT 1 FROM task_attempts newer WHERE newer.task_id = ${tasks.id} AND newer.attempt_n > ${input.attemptN})`,
          ),
        )
        // Fence lease/status changes without blocking reporter inserts' FK
        // checks. FOR UPDATE can deadlock with the message sequence lock when
        // a Durable commit and the reporter append to this attempt together.
        .for('no key update');
      return row ?? null;
    },
    async findAttempt(teamId: string, taskId: string, attemptN: number) {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeStoreAttempts)
        .where(
          and(
            eq(runtimeStoreAttempts.teamId, teamId),
            eq(runtimeStoreAttempts.taskId, taskId),
            eq(runtimeStoreAttempts.attemptN, attemptN),
          ),
        );
      return row ?? null;
    },
    async listAttempts(teamId: string, storeId: string) {
      return getExecutor(db)
        .select()
        .from(runtimeStoreAttempts)
        .where(
          and(
            eq(runtimeStoreAttempts.teamId, teamId),
            eq(runtimeStoreAttempts.storeId, storeId),
          ),
        );
    },
    async listCommitTaskIds(storeId: string) {
      const rows = await getExecutor(db)
        .selectDistinct({ taskId: runtimeStoreCommits.taskId })
        .from(runtimeStoreCommits)
        .where(eq(runtimeStoreCommits.storeId, storeId));
      return rows.map((row) => row.taskId);
    },
    async bindAttempt(input: typeof runtimeStoreAttempts.$inferInsert) {
      transactionRequired();
      await getExecutor(db).insert(runtimeStoreAttempts).values(input);
    },
    async create(teamId: string): Promise<RuntimeStore> {
      transactionRequired();
      const [row] = await getExecutor(db)
        .insert(runtimeStores)
        .values({ teamId })
        .returning();
      return row;
    },
    async fork(source: RuntimeStore): Promise<RuntimeStore> {
      transactionRequired();
      const [row] = await getExecutor(db)
        .insert(runtimeStores)
        .values({
          teamId: source.teamId,
          format: source.format,
          headSeq: source.headSeq,
          nextId: source.nextId,
        })
        .returning();
      await getExecutor(db).execute(sql`
        INSERT INTO runtime_store_commits
          (store_id, seq, commit_id, sha256, object_key, size_bytes, task_id, attempt_n, created_at)
        SELECT ${row.id}, seq, commit_id, sha256, object_key, size_bytes, task_id, attempt_n, created_at
        FROM runtime_store_commits
        WHERE store_id = ${source.id} AND seq <= ${source.headSeq}
      `);
      await getExecutor(db).execute(sql`
        INSERT INTO runtime_conversation_records (store_id, type, id, seq, conversation_id, address, value)
        SELECT ${row.id}, type, id, seq, conversation_id, address, value
        FROM runtime_conversation_records WHERE store_id = ${source.id} AND seq <= ${source.headSeq}
      `);
      await getExecutor(db).execute(sql`
        INSERT INTO runtime_conversation_heads (store_id, seq)
        SELECT ${row.id}, LEAST(seq, ${source.headSeq}) FROM runtime_conversation_heads WHERE store_id = ${source.id}
      `);
      return row;
    },
    async lock(teamId: string, id: string) {
      transactionRequired();
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeStores)
        .where(and(eq(runtimeStores.id, id), eq(runtimeStores.teamId, teamId)))
        .for('update');
      return row ?? null;
    },
    async get(teamId: string, id: string) {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeStores)
        .where(and(eq(runtimeStores.id, id), eq(runtimeStores.teamId, teamId)));
      return row ?? null;
    },
    async update(
      id: string,
      patch: Partial<Omit<RuntimeStore, 'id' | 'teamId' | 'createdAt'>>,
    ) {
      transactionRequired();
      await getExecutor(db)
        .update(runtimeStores)
        .set(patch)
        .where(eq(runtimeStores.id, id));
    },
    async findCommit(storeId: string, commitId: string) {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeStoreCommits)
        .where(
          and(
            eq(runtimeStoreCommits.storeId, storeId),
            eq(runtimeStoreCommits.commitId, commitId),
          ),
        );
      return row ?? null;
    },
    async append(input: Omit<RuntimeStoreCommit, 'createdAt'>) {
      transactionRequired();
      await getExecutor(db).insert(runtimeStoreCommits).values(input);
      await getExecutor(db)
        .update(runtimeStores)
        .set({ headSeq: input.seq })
        .where(eq(runtimeStores.id, input.storeId));
    },
    async attemptBounds(storeId: string, taskId: string, attemptN: number) {
      const [row] = await getExecutor(db)
        .select({
          firstSeq: sql<number>`coalesce(min(${runtimeStoreCommits.seq}), 0)::integer`,
          lastSeq: sql<number>`coalesce(max(${runtimeStoreCommits.seq}), 0)::integer`,
        })
        .from(runtimeStoreCommits)
        .where(
          and(
            eq(runtimeStoreCommits.storeId, storeId),
            eq(runtimeStoreCommits.taskId, taskId),
            eq(runtimeStoreCommits.attemptN, attemptN),
          ),
        );
      return row;
    },
    async listCommits(
      storeId: string,
      afterSeq: number,
      limit: number,
      headSeq: number,
    ) {
      return getExecutor(db)
        .select()
        .from(runtimeStoreCommits)
        .where(
          and(
            eq(runtimeStoreCommits.storeId, storeId),
            gt(runtimeStoreCommits.seq, afterSeq),
            lte(runtimeStoreCommits.seq, headSeq),
          ),
        )
        .orderBy(asc(runtimeStoreCommits.seq))
        .limit(limit);
    },
  };
}

export type RuntimeStoreRepository = ReturnType<
  typeof createRuntimeStoreRepository
>;
