import { KetoNamespace } from '@moltnet/auth';
import {
  agents,
  createDatabase,
  createDrizzleTransactionRunner,
  createTaskRepository,
  type Database,
  diaries,
  enqueueWorkflowInCurrentTransaction,
  runMigrations,
  taskAttempts,
  tasks,
  teams,
} from '@moltnet/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTaskService } from './task.service.js';

const AGENT_ID = '10000000-0000-4000-8000-000000000001';
const TEAM_ID = '20000000-0000-4000-8000-000000000002';
const DIARY_ID = '30000000-0000-4000-8000-000000000003';
const TASK_ID = '40000000-0000-4000-8000-000000000004';
const DBOS_TEST_SCHEMA = 'dbos_claim_test';

describe('task claim transactional enqueue (real Postgres)', () => {
  let db: Database;
  let closePool: () => Promise<void>;
  let stopContainer: () => Promise<void>;

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();
    stopContainer = () => container.stop().then(() => undefined);

    const databaseUrl = container.getConnectionUri();
    await runMigrations(databaseUrl);
    const connection = createDatabase(databaseUrl);
    db = connection.db;
    closePool = () => connection.pool.end();

    await db.execute(
      sql.raw(`
      CREATE SCHEMA ${DBOS_TEST_SCHEMA};
      CREATE TABLE ${DBOS_TEST_SCHEMA}.enqueue_control (
        should_fail boolean NOT NULL DEFAULT false
      );
      INSERT INTO ${DBOS_TEST_SCHEMA}.enqueue_control DEFAULT VALUES;
      CREATE TABLE ${DBOS_TEST_SCHEMA}.workflow_status (
        workflow_id text PRIMARY KEY,
        workflow_name text NOT NULL,
        queue_name text NOT NULL,
        positional_args json[] NOT NULL
      );
      CREATE FUNCTION ${DBOS_TEST_SCHEMA}.enqueue_workflow(
        workflow_name text,
        queue_name text,
        positional_args json[],
        named_args json,
        workflow_id text,
        app_version text,
        timeout_ms bigint,
        deadline_epoch_ms bigint,
        deduplication_id text,
        priority integer,
        queue_partition_key text
      ) RETURNS text
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF (SELECT should_fail FROM ${DBOS_TEST_SCHEMA}.enqueue_control LIMIT 1) THEN
          RAISE EXCEPTION 'injected enqueue failure';
        END IF;
        INSERT INTO ${DBOS_TEST_SCHEMA}.workflow_status (
          workflow_id,
          workflow_name,
          queue_name,
          positional_args
        ) VALUES (
          enqueue_workflow.workflow_id,
          enqueue_workflow.workflow_name,
          enqueue_workflow.queue_name,
          enqueue_workflow.positional_args
        ) ON CONFLICT ON CONSTRAINT workflow_status_pkey DO NOTHING;
        RETURN enqueue_workflow.workflow_id;
      END;
      $function$;
    `),
    );

    await db.insert(agents).values({
      id: AGENT_ID,
      publicKey: `ed25519:${'a'.repeat(44)}`,
      fingerprint: 'AAAA-BBBB-CCCC-DDDD',
    });
    await db.insert(teams).values({
      id: TEAM_ID,
      name: 'Transactional claim team',
      creatorAgentId: AGENT_ID,
    });
    await db.insert(diaries).values({
      id: DIARY_ID,
      teamId: TEAM_ID,
      creatorAgentId: AGENT_ID,
      name: 'Transactional claim diary',
    });
    await db.insert(tasks).values({
      id: TASK_ID,
      taskType: 'freeform',
      teamId: TEAM_ID,
      diaryId: DIARY_ID,
      outputKind: 'artifact',
      input: { brief: 'prove the transactional claim boundary' },
      inputSchemaCid: 'bafy-schema',
      inputCid: 'bafy-input',
      proposedByAgentId: AGENT_ID,
      status: 'queued',
    });
  }, 60_000);

  afterAll(async () => {
    await closePool?.();
    await stopContainer?.();
  });

  it('commits and rolls back task, attempt, and stable workflow enqueue together', async () => {
    const taskRepository = createTaskRepository(db);
    const transactionRunner = createDrizzleTransactionRunner(db);
    const enqueue = (
      input: Parameters<typeof enqueueWorkflowInCurrentTransaction>[1],
    ) =>
      enqueueWorkflowInCurrentTransaction(db, {
        ...input,
        schemaName: DBOS_TEST_SCHEMA,
      });
    const service = createTaskService({
      taskRepository,
      transactionRunner,
      enqueueWorkflowInCurrentTransaction: enqueue,
      permissionChecker: {
        canClaimTask: vi.fn().mockResolvedValue(true),
      },
      runtimeProfileRepository: { findById: vi.fn() },
      runtimePolicyService: { resolvePinnedAllowedTools: vi.fn() },
      agentRepository: { findById: vi.fn() },
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as never);

    await db.execute(
      sql.raw(
        `UPDATE ${DBOS_TEST_SCHEMA}.enqueue_control SET should_fail = true`,
      ),
    );
    let enqueueFailure: unknown;
    try {
      await service.claim(
        TASK_ID,
        AGENT_ID,
        KetoNamespace.Agent,
        30,
        {},
        TEAM_ID,
      );
    } catch (error) {
      enqueueFailure = error;
    }
    expect(enqueueFailure).toBeInstanceOf(Error);
    expect(
      (enqueueFailure as Error & { cause?: Error }).cause?.message,
    ).toContain('injected enqueue failure');

    const [rolledBackTask] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, TASK_ID));
    const rolledBackAttempts = await db
      .select()
      .from(taskAttempts)
      .where(eq(taskAttempts.taskId, TASK_ID));
    const rolledBackWorkflows = await db.execute(
      sql.raw(`SELECT workflow_id FROM ${DBOS_TEST_SCHEMA}.workflow_status`),
    );
    expect(rolledBackTask).toMatchObject({
      status: 'queued',
      claimAgentId: null,
      claimExpiresAt: null,
    });
    expect(rolledBackAttempts).toHaveLength(0);
    expect(rolledBackWorkflows.rows).toHaveLength(0);

    await db.execute(
      sql.raw(
        `UPDATE ${DBOS_TEST_SCHEMA}.enqueue_control SET should_fail = false`,
      ),
    );
    await service.claim(
      TASK_ID,
      AGENT_ID,
      KetoNamespace.Agent,
      30,
      {},
      TEAM_ID,
    );
    const workflowId = `task:${TASK_ID}:attempt:1`;

    await transactionRunner.runInTransaction(async () => {
      await enqueue({
        workflowName: 'task.workflow.startAttempt',
        queueName: 'task-attempts',
        workflowId,
      });
      await enqueue({
        workflowName: 'task.workflow.startAttempt',
        queueName: 'task-attempts',
        workflowId,
      });
    });

    const [committedTask] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, TASK_ID));
    const committedAttempts = await db
      .select()
      .from(taskAttempts)
      .where(eq(taskAttempts.taskId, TASK_ID));
    const committedWorkflows = await db.execute(
      sql.raw(`SELECT workflow_id FROM ${DBOS_TEST_SCHEMA}.workflow_status`),
    );
    expect(committedTask).toMatchObject({
      status: 'dispatched',
      claimAgentId: AGENT_ID,
    });
    expect(committedAttempts).toHaveLength(1);
    expect(committedAttempts[0]).toMatchObject({
      taskId: TASK_ID,
      attemptN: 1,
      claimedByAgentId: AGENT_ID,
      workflowId,
    });
    expect(committedWorkflows.rows).toEqual([{ workflow_id: workflowId }]);
  });
});
