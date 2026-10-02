import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
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
  return {
    async lockAuthority(input: RuntimeStoreAuthority) {
      transactionRequired();
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
        .for('update');
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
