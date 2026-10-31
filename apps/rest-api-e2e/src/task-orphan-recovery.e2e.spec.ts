/**
 * Real API + Postgres + DBOS + Keto regression for orphan force-release.
 * Seed abandoned attempts without starting an attempt workflow, then enqueue
 * the production sweeper on a served queue. No DBOS/transaction mocks.
 */
import { randomUUID } from 'node:crypto';

import {
  createClient,
  createTask,
  getTask,
  listTaskAttempts,
} from '@moltnet/api-client';
import { createRelationshipWriter } from '@moltnet/auth';
import {
  createDrizzleTransactionRunner,
  enqueueWorkflowInCurrentTransaction,
  taskAttempts,
  tasks,
} from '@moltnet/database';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, pollUntil, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Orphan task recovery through real DBOS', () => {
  let harness: TestHarness;
  let agent: TestAgent;
  const client = createClient({
    baseUrl: process.env.SERVER_BASE_URL ?? 'http://localhost:8080',
  });
  const auth = () => agent.accessToken;
  const headers = () => ({ 'x-moltnet-team-id': agent.personalTeamId });

  beforeAll(async () => {
    harness = await createTestHarness();
    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
  });
  afterAll(async () => {
    await harness?.teardown();
  });

  async function seedAttempt(
    maxAttempts: number,
    running = false,
    healthy = false,
  ) {
    const created = await createTask({
      client,
      auth,
      headers: headers(),
      body: {
        taskType: 'freeform',
        diaryId: agent.privateDiaryId,
        input: { brief: 'orphan recovery regression' },
        maxAttempts,
        runningTimeoutSec: 30,
      },
    });
    expect(created.error).toBeUndefined();
    const taskId = created.data!.id;
    // A 1-second grace in the manually enqueued sweep avoids wall-clock waits.
    // The regular scheduler's 300-second grace cannot select these fixtures.
    const stale = new Date(Date.now() - 10_000);
    const future = new Date(Date.now() + 3_600_000);
    await harness.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          status: running ? 'running' : 'dispatched',
          claimAgentId: agent.agentId,
          claimExpiresAt: running || healthy ? future : stale,
        })
        .where(eq(tasks.id, taskId));
      await tx.insert(taskAttempts).values({
        taskId,
        attemptN: 1,
        claimedByAgentId: agent.agentId,
        workflowId: `missing:${randomUUID()}`,
        status: running ? 'running' : 'claimed',
        startedAt: running ? new Date(Date.now() - 40_000) : null,
      });
    });
    await createRelationshipWriter(
      harness.oryClients.relationship,
    ).grantTaskClaimant(taskId, agent.agentId);
    return taskId;
  }

  async function sweep(gracePeriodSec = 1) {
    const workflowId = `e2e:orphan-sweep:${randomUUID()}`;
    await createDrizzleTransactionRunner(harness.db).runInTransaction(() =>
      enqueueWorkflowInCurrentTransaction(harness.db, {
        workflowName: 'maintenance.taskOrphanSweeper',
        // Queue membership controls dispatch, not workflow identity. Use an
        // existing served queue to invoke the production handler immediately.
        queueName: 'task-deletion-cleanup',
        workflowId,
        positionalArgs: [{ gracePeriodSec, batchSize: 100 }],
      }),
    );
    const row = await pollUntil(
      async () => {
        const result = await harness.db.execute<{
          status: string;
          error: string | null;
        }>(sql`
        SELECT status, error FROM dbos.workflow_status WHERE workflow_uuid = ${workflowId}
      `);
        return result.rows[0];
      },
      (value) => value?.status === 'SUCCESS' || value?.status === 'ERROR',
      {
        maxAttempts: 100,
        intervalMs: 200,
        label: 'orphan sweeper workflow completion',
      },
    );
    expect(row, JSON.stringify(row)).toMatchObject({ status: 'SUCCESS' });
    return workflowId;
  }

  async function claimantCount(taskId: string) {
    const result = await harness.oryClients.relationshipRead.getRelationships({
      namespace: 'Task',
      object: taskId,
      relation: 'claimant',
    });
    return result.relation_tuples?.length ?? 0;
  }

  async function assertReleased(taskId: string, status: 'queued' | 'failed') {
    const task = await getTask({
      client,
      auth,
      headers: headers(),
      path: { id: taskId },
    });
    expect(task.error).toBeUndefined();
    expect(task.data).toMatchObject({ status });
    const [row] = await harness.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(row).toMatchObject({ claimAgentId: null, claimExpiresAt: null });
    const attempts = await listTaskAttempts({
      client,
      auth,
      headers: headers(),
      path: { id: taskId },
    });
    expect(attempts.error).toBeUndefined();
    expect(attempts.data).toHaveLength(1);
    expect(attempts.data![0]).toMatchObject({
      status: 'timed_out',
      error: { code: 'orphaned' },
    });
    expect(attempts.data![0].completedAt).not.toBeNull();
    await pollUntil(
      () => claimantCount(taskId),
      (count) => count === 0,
      { label: 'orphan claimant removed from Keto' },
    );
    return attempts.data![0].completedAt;
  }

  it.each([
    { maxAttempts: 2, running: false, status: 'queued' as const },
    { maxAttempts: 1, running: false, status: 'failed' as const },
    { maxAttempts: 1, running: true, status: 'failed' as const },
  ])(
    'releases abandoned attempts: $maxAttempts attempts, running=$running → $status',
    async ({ maxAttempts, running, status }) => {
      const taskId = await seedAttempt(maxAttempts, running);
      expect(await claimantCount(taskId)).toBe(1);
      await sweep();
      const completedAt = await assertReleased(taskId, status);
      // A later sweep must leave the terminal attempt and retry budget intact.
      await sweep();
      expect(await assertReleased(taskId, status)).toBe(completedAt);
    },
  );

  it('force-releases at the backstop after resume accepts a missing workflow', async () => {
    const taskId = await seedAttempt(2);
    await harness.db
      .update(tasks)
      .set({
        claimExpiresAt: new Date(Date.now() - 90_000),
      })
      .where(eq(tasks.id, taskId));
    // The SDK accepts resume even for a missing workflow. The first pass
    // leaves the attempt alone; the later backstop must still release it.
    await sweep(60);
    const firstPass = await getTask({
      client,
      auth,
      headers: headers(),
      path: { id: taskId },
    });
    expect(firstPass.error).toBeUndefined();
    expect(firstPass.data?.status).toBe('dispatched');
    expect(await claimantCount(taskId)).toBe(1);
    await sweep(1);
    await assertReleased(taskId, 'queued');
  });

  it('keeps healthy claims intact', async () => {
    const taskId = await seedAttempt(2, false, true);
    await sweep();
    const task = await getTask({
      client,
      auth,
      headers: headers(),
      path: { id: taskId },
    });
    expect(task.data).toMatchObject({ status: 'dispatched' });
    const [row] = await harness.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(row.claimAgentId).toBe(agent.agentId);
    expect(row.claimExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await claimantCount(taskId)).toBe(1);
  });

  it('rolls back attempt writes on task-update failure, isolates the batch, and recovers next sweep', async () => {
    const broken = await seedAttempt(1);
    const other = await seedAttempt(2);
    // Fault only this fixture. Fail the second write after updateAttempt ran;
    // a real transaction must roll back both the write and its checkpoint.
    await harness.db.execute(sql`
      CREATE FUNCTION e2e_orphan_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.id = '${sql.raw(broken)}'::uuid AND NEW.status = 'failed' THEN
          RAISE EXCEPTION 'injected orphan task update failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await harness.db.execute(sql`CREATE TRIGGER e2e_orphan_reject_update
      BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION e2e_orphan_reject_update()`);
    try {
      await sweep();
      await assertReleased(other, 'queued');
      const [attempt] = await harness.db
        .select()
        .from(taskAttempts)
        .where(eq(taskAttempts.taskId, broken));
      expect(attempt).toMatchObject({
        status: 'claimed',
        completedAt: null,
        error: null,
      });
      const task = await getTask({
        client,
        auth,
        headers: headers(),
        path: { id: broken },
      });
      expect(task.data).toMatchObject({ status: 'dispatched' });
      const [row] = await harness.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, broken));
      expect(row.claimAgentId).toBe(agent.agentId);
      expect(row.claimExpiresAt).not.toBeNull();
      expect(await claimantCount(broken)).toBe(1);
    } finally {
      await harness.db.execute(
        sql`DROP TRIGGER e2e_orphan_reject_update ON tasks`,
      );
      await harness.db.execute(sql`DROP FUNCTION e2e_orphan_reject_update()`);
    }
    await sweep();
    await assertReleased(broken, 'failed');
  });
});
