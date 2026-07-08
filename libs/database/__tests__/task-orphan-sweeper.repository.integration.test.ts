/**
 * Integration tests for the task maintenance queries used by the
 * orphan and expiry sweepers.
 *
 * Spins up an ephemeral pgvector/pgvector:pg16 container via
 * testcontainers, applies all Drizzle migrations, seeds the FK rows
 * (team, agent, diary) needed by the tasks table, and verifies that
 * `listOrphanedTasks` returns exactly the rows whose claim_expires_at
 * is older than the supplied cutoff and whose status is non-terminal,
 * and `listExpiredNonTerminalTasks` / `expireIfStillNonTerminal` handle
 * task-level lifetime expiry for waiting/queued tasks.
 *
 * The `forceReleaseAttempt` step is straight-line code over existing
 * repository methods (`updateAttempt`, `updateStatus`, `findById`)
 * already exercised by the in-workflow timeout path in the
 * apps/rest-api e2e suite — so this test focuses on the new query
 * surface, not the persist transaction shape.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createRuntimeSessionRepository } from '../src/repositories/runtime-session.repository.js';
import { createTaskRepository } from '../src/repositories/task.repository.js';
import { createTaskArtifactRepository } from '../src/repositories/task-artifact.repository.js';
import {
  agents,
  diaries,
  runtimeSessions,
  taskArtifacts,
  taskAttempts,
  tasks,
  teams,
} from '../src/schema.js';
import { createDrizzleTransactionRunner } from '../src/transaction-context.js';

describe('TaskRepository maintenance sweeper queries (integration)', () => {
  let db: Database;
  let pool: Pool;
  let repo: ReturnType<typeof createTaskRepository>;
  let artifactRepo: ReturnType<typeof createTaskArtifactRepository>;
  let runtimeSessionRepo: ReturnType<typeof createRuntimeSessionRepository>;
  let transactionRunner: ReturnType<typeof createDrizzleTransactionRunner>;
  let stopContainer: (() => Promise<void>) | undefined;

  const TEAM_ID = '11111111-1111-4111-8111-111111111101';
  const AGENT_ID = '22222222-2222-4222-8222-222222222202';
  const DIARY_ID = '33333333-3333-4333-8333-333333333303';

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();

    const databaseUrl = container.getConnectionUri();
    stopContainer = () => container.stop().then(() => undefined);

    await runMigrations(databaseUrl);
    ({ db, pool } = createDatabase(databaseUrl));
    repo = createTaskRepository(db);
    artifactRepo = createTaskArtifactRepository(db);
    runtimeSessionRepo = createRuntimeSessionRepository(db);
    transactionRunner = createDrizzleTransactionRunner(db);

    // Seed FK rows once — task inserts cascade through these.
    // Note: agents must exist before teams reference them via createdBy.
    await db.insert(agents).values({
      identityId: AGENT_ID,
      publicKey: 'ed25519:dGVzdA==',
      fingerprint: 'AAAA-BBBB-CCCC-DDDD',
    });
    await db.insert(teams).values({
      id: TEAM_ID,
      name: 'sweeper-test-team',
      personal: true,
      creatorAgentId: AGENT_ID,
    });
    await db.insert(diaries).values({
      id: DIARY_ID,
      name: 'sweeper-test-diary',
      creatorAgentId: AGENT_ID,
      teamId: TEAM_ID,
    });
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await db.delete(taskArtifacts);
      await db.delete(runtimeSessions);
      await db.delete(taskAttempts);
      await db.delete(tasks);
      await db.delete(diaries);
      await db.delete(teams);
      await db.delete(agents);
    }
    await pool?.end();
    await stopContainer?.();
  });

  async function seedTask(opts: {
    id: string;
    status:
      | 'waiting'
      | 'queued'
      | 'dispatched'
      | 'running'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'expired';
    claimExpiresAt: Date | null;
    expiresAt?: Date | null;
    completedAt?: Date | null;
    createAttempt?: boolean;
    attemptStatus?: 'claimed' | 'running' | 'timed_out' | 'completed';
  }): Promise<void> {
    await db.insert(tasks).values({
      id: opts.id,
      taskType: 'curate_pack',
      teamId: TEAM_ID,
      diaryId: DIARY_ID,
      outputKind: 'artifact',
      input: {},
      inputSchemaCid: 'cid-placeholder-input-schema',
      inputCid: 'cid-placeholder-input',
      proposedByAgentId: AGENT_ID,
      status: opts.status,
      claimAgentId:
        opts.status === 'dispatched' || opts.status === 'running'
          ? AGENT_ID
          : null,
      claimExpiresAt: opts.claimExpiresAt,
      expiresAt: opts.expiresAt ?? null,
      completedAt: opts.completedAt ?? null,
      cancelledByAgentId: opts.status === 'cancelled' ? AGENT_ID : null,
      cancelReason:
        opts.status === 'cancelled' ? 'retention integration fixture' : null,
      maxAttempts: 1,
    });
    if (opts.createAttempt) {
      await db.insert(taskAttempts).values({
        taskId: opts.id,
        attemptN: 1,
        claimedByAgentId: AGENT_ID,
        workflowId: `task:${opts.id}:attempt:1`,
        status: opts.attemptStatus ?? 'running',
      });
    }
  }

  it('returns rows whose claim_expires_at is older than the cutoff', async () => {
    const NOW = new Date('2026-04-26T10:00:00Z');
    const STALE_TASK = '44444444-4444-4444-8444-444444444401';
    const FRESH_TASK = '44444444-4444-4444-8444-444444444402';

    // Stale: claim_expires_at 10 minutes ago.
    await seedTask({
      id: STALE_TASK,
      status: 'running',
      claimExpiresAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      createAttempt: true,
      attemptStatus: 'running',
    });
    // Fresh: claim_expires_at 30 seconds in the future.
    await seedTask({
      id: FRESH_TASK,
      status: 'running',
      claimExpiresAt: new Date(NOW.getTime() + 30_000),
      createAttempt: true,
      attemptStatus: 'running',
    });

    // Cutoff: 5 minutes ago. Only STALE_TASK qualifies.
    const cutoff = new Date(NOW.getTime() - 5 * 60 * 1000);
    const result = await repo.listOrphanedTasks(cutoff, 100);
    const ids = result.map((r) => r.task.id);
    expect(ids).toContain(STALE_TASK);
    expect(ids).not.toContain(FRESH_TASK);

    await db.delete(taskAttempts);
    await db.delete(tasks);
  });

  it('excludes tasks already in terminal states (completed / failed / cancelled / expired)', async () => {
    const NOW = new Date('2026-04-26T10:00:00Z');
    const CUTOFF = new Date(NOW.getTime() - 5 * 60 * 1000);
    const STALE_RUNNING = '55555555-5555-4555-8555-555555555501';
    const STALE_COMPLETED = '55555555-5555-4555-8555-555555555502';
    const STALE_FAILED = '55555555-5555-4555-8555-555555555503';

    // All three have stale claim_expires_at, but only the non-terminal
    // one should be returned. (`completed` / `failed` are terminal — the
    // sweeper has nothing to do for them.)
    await seedTask({
      id: STALE_RUNNING,
      status: 'running',
      claimExpiresAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      createAttempt: true,
      attemptStatus: 'running',
    });
    await seedTask({
      id: STALE_COMPLETED,
      status: 'completed',
      claimExpiresAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      createAttempt: true,
      attemptStatus: 'completed',
    });
    await seedTask({
      id: STALE_FAILED,
      status: 'failed',
      claimExpiresAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      createAttempt: true,
      attemptStatus: 'timed_out',
    });

    const result = await repo.listOrphanedTasks(CUTOFF, 100);
    const ids = result.map((r) => r.task.id);
    expect(ids).toContain(STALE_RUNNING);
    expect(ids).not.toContain(STALE_COMPLETED);
    expect(ids).not.toContain(STALE_FAILED);

    await db.delete(taskAttempts);
    await db.delete(tasks);
  });

  it('returns the matching active attempt (status claimed or running)', async () => {
    const NOW = new Date('2026-04-26T10:00:00Z');
    const CUTOFF = new Date(NOW.getTime() - 5 * 60 * 1000);
    const TASK_ID = '66666666-6666-4666-8666-666666666601';

    await seedTask({
      id: TASK_ID,
      status: 'dispatched',
      claimExpiresAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      createAttempt: true,
      attemptStatus: 'claimed',
    });

    const result = await repo.listOrphanedTasks(CUTOFF, 100);
    const row = result.find((r) => r.task.id === TASK_ID);
    expect(row).toBeDefined();
    expect(row!.attempt.attemptN).toBe(1);
    expect(row!.attempt.workflowId).toBe(`task:${TASK_ID}:attempt:1`);
    expect(row!.attempt.status).toBe('claimed');

    await db.delete(taskAttempts);
    await db.delete(tasks);
  });

  it('returns empty when no tasks are orphaned', async () => {
    const NOW = new Date('2026-04-26T10:00:00Z');
    const CUTOFF = new Date(NOW.getTime() - 5 * 60 * 1000);
    const result = await repo.listOrphanedTasks(CUTOFF, 100);
    expect(result).toHaveLength(0);
  });

  it('respects the limit parameter', async () => {
    const NOW = new Date('2026-04-26T10:00:00Z');
    const CUTOFF = new Date(NOW.getTime() - 5 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      await seedTask({
        id: `77777777-7777-4777-8777-77777777770${i}`,
        status: 'running',
        claimExpiresAt: new Date(NOW.getTime() - 10 * 60 * 1000),
        createAttempt: true,
        attemptStatus: 'running',
      });
    }

    const result = await repo.listOrphanedTasks(CUTOFF, 2);
    expect(result).toHaveLength(2);

    await db.delete(taskAttempts);
    await db.delete(tasks);
  });

  it('lists only waiting or queued tasks whose task lifetime elapsed', async () => {
    const NOW = new Date('2026-04-26T10:00:00Z');
    const EXPIRED_WAITING = '88888888-8888-4888-8888-888888888801';
    const EXPIRED_QUEUED = '88888888-8888-4888-8888-888888888802';
    const FUTURE_WAITING = '88888888-8888-4888-8888-888888888803';
    const EXPIRED_RUNNING = '88888888-8888-4888-8888-888888888804';
    const TERMINAL_EXPIRED = '88888888-8888-4888-8888-888888888805';
    const BOUNDARY_WAITING = '88888888-8888-4888-8888-888888888806';

    await seedTask({
      id: EXPIRED_WAITING,
      status: 'waiting',
      claimExpiresAt: null,
      expiresAt: new Date(NOW.getTime() - 60_000),
    });
    await seedTask({
      id: EXPIRED_QUEUED,
      status: 'queued',
      claimExpiresAt: null,
      expiresAt: new Date(NOW.getTime() - 30_000),
    });
    await seedTask({
      id: FUTURE_WAITING,
      status: 'waiting',
      claimExpiresAt: null,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    await seedTask({
      id: EXPIRED_RUNNING,
      status: 'running',
      claimExpiresAt: null,
      expiresAt: new Date(NOW.getTime() - 60_000),
      createAttempt: true,
      attemptStatus: 'running',
    });
    await seedTask({
      id: TERMINAL_EXPIRED,
      status: 'expired',
      claimExpiresAt: null,
      expiresAt: new Date(NOW.getTime() - 60_000),
    });
    await seedTask({
      id: BOUNDARY_WAITING,
      status: 'waiting',
      claimExpiresAt: null,
      expiresAt: NOW,
    });

    const result = await repo.listExpiredNonTerminalTasks(NOW, 100);
    const ids = result.map((task) => task.id);
    expect(ids).toEqual([EXPIRED_WAITING, EXPIRED_QUEUED, BOUNDARY_WAITING]);
    expect(ids).not.toContain(FUTURE_WAITING);
    expect(ids).not.toContain(EXPIRED_RUNNING);
    expect(ids).not.toContain(TERMINAL_EXPIRED);

    await db.delete(taskAttempts);
    await db.delete(tasks);
  });

  it('expires waiting or queued tasks with a conditional update only', async () => {
    const NOW = new Date('2026-04-26T10:00:00Z');
    const WAITING_TASK = '99999999-9999-4999-8999-999999999901';
    const RUNNING_TASK = '99999999-9999-4999-8999-999999999902';

    await seedTask({
      id: WAITING_TASK,
      status: 'waiting',
      claimExpiresAt: null,
      expiresAt: new Date(NOW.getTime() - 60_000),
    });
    await seedTask({
      id: RUNNING_TASK,
      status: 'running',
      claimExpiresAt: null,
      expiresAt: new Date(NOW.getTime() - 60_000),
      createAttempt: true,
      attemptStatus: 'running',
    });

    const expired = await repo.expireIfStillNonTerminal(WAITING_TASK);
    const skipped = await repo.expireIfStillNonTerminal(RUNNING_TASK);

    expect(expired?.status).toBe('expired');
    expect(expired?.completedAt).toBeInstanceOf(Date);
    expect(skipped).toBeNull();

    const running = await repo.findById(RUNNING_TASK);
    expect(running?.status).toBe('running');

    await db.delete(taskAttempts);
    await db.delete(tasks);
  });

  it('expires a batch of waiting or queued tasks with one conditional update', async () => {
    const NOW = new Date('2026-04-26T10:00:00Z');
    const WAITING_TASK = '99999999-9999-4999-8999-999999999903';
    const QUEUED_TASK = '99999999-9999-4999-8999-999999999904';
    const RUNNING_TASK = '99999999-9999-4999-8999-999999999905';

    await seedTask({
      id: WAITING_TASK,
      status: 'waiting',
      claimExpiresAt: null,
      expiresAt: new Date(NOW.getTime() - 60_000),
    });
    await seedTask({
      id: QUEUED_TASK,
      status: 'queued',
      claimExpiresAt: null,
      expiresAt: new Date(NOW.getTime() - 60_000),
    });
    await seedTask({
      id: RUNNING_TASK,
      status: 'running',
      claimExpiresAt: null,
      expiresAt: new Date(NOW.getTime() - 60_000),
      createAttempt: true,
      attemptStatus: 'running',
    });

    const expired = await repo.expireManyIfStillNonTerminal([
      WAITING_TASK,
      QUEUED_TASK,
      RUNNING_TASK,
      WAITING_TASK,
    ]);
    const expiredIds = expired.map((task) => task.id).sort();

    expect(expiredIds).toEqual([QUEUED_TASK, WAITING_TASK].sort());
    await expect(repo.findById(WAITING_TASK)).resolves.toMatchObject({
      status: 'expired',
    });
    await expect(repo.findById(QUEUED_TASK)).resolves.toMatchObject({
      status: 'expired',
    });
    await expect(repo.findById(RUNNING_TASK)).resolves.toMatchObject({
      status: 'running',
    });

    await db.delete(taskAttempts);
    await db.delete(tasks);
  });

  it('does not claim queued tasks whose task lifetime elapsed', async () => {
    const EXPIRED_QUEUED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
    const FRESH_QUEUED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02';

    await seedTask({
      id: EXPIRED_QUEUED,
      status: 'queued',
      claimExpiresAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await seedTask({
      id: FRESH_QUEUED,
      status: 'queued',
      claimExpiresAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const expiredClaim = await repo.claimIfQueued(EXPIRED_QUEUED);
    const freshClaim = await repo.claimIfQueued(FRESH_QUEUED);

    expect(expiredClaim).toBeNull();
    expect(freshClaim?.status).toBe('dispatched');

    const expired = await repo.findById(EXPIRED_QUEUED);
    expect(expired?.status).toBe('queued');

    await db.delete(taskAttempts);
    await db.delete(tasks);
  });

  it('lists terminal tasks whose status-specific retention window elapsed', async () => {
    const NOW = new Date('2026-04-26T10:00:00Z');
    const OLD_COMPLETED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
    const FRESH_COMPLETED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';
    const OLD_FAILED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03';
    const FRESH_FAILED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04';
    const OLD_CANCELLED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05';
    const OLD_EXPIRED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06';
    const OLD_QUEUED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb07';
    const BOUNDARY_COMPLETED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb08';
    const BOUNDARY_FAILED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb09';

    await seedTask({
      id: OLD_COMPLETED,
      status: 'completed',
      claimExpiresAt: null,
      completedAt: new Date(NOW.getTime() - 181 * 24 * 60 * 60 * 1000),
    });
    await seedTask({
      id: FRESH_COMPLETED,
      status: 'completed',
      claimExpiresAt: null,
      completedAt: new Date(NOW.getTime() - 179 * 24 * 60 * 60 * 1000),
    });
    await seedTask({
      id: OLD_FAILED,
      status: 'failed',
      claimExpiresAt: null,
      completedAt: new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000),
    });
    await seedTask({
      id: FRESH_FAILED,
      status: 'failed',
      claimExpiresAt: null,
      completedAt: new Date(NOW.getTime() - 89 * 24 * 60 * 60 * 1000),
    });
    await seedTask({
      id: BOUNDARY_COMPLETED,
      status: 'completed',
      claimExpiresAt: null,
      completedAt: new Date(NOW.getTime() - 180 * 24 * 60 * 60 * 1000),
    });
    await seedTask({
      id: BOUNDARY_FAILED,
      status: 'failed',
      claimExpiresAt: null,
      completedAt: new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000),
    });
    await seedTask({
      id: OLD_CANCELLED,
      status: 'cancelled',
      claimExpiresAt: null,
      completedAt: new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000),
    });
    await seedTask({
      id: OLD_EXPIRED,
      status: 'expired',
      claimExpiresAt: null,
      completedAt: new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000),
    });
    await seedTask({
      id: OLD_QUEUED,
      status: 'queued',
      claimExpiresAt: null,
      completedAt: new Date(NOW.getTime() - 181 * 24 * 60 * 60 * 1000),
    });

    const result = await repo.listTerminalTasksPastRetention(
      {
        completedBefore: new Date(NOW.getTime() - 180 * 24 * 60 * 60 * 1000),
        failedBefore: new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000),
        cancelledBefore: new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000),
        expiredBefore: new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000),
      },
      100,
    );
    const ids = result.map((task) => task.id);

    expect(ids).toEqual([
      OLD_COMPLETED,
      BOUNDARY_COMPLETED,
      OLD_FAILED,
      OLD_CANCELLED,
      OLD_EXPIRED,
      BOUNDARY_FAILED,
    ]);
    expect(ids).not.toContain(FRESH_COMPLETED);
    expect(ids).not.toContain(FRESH_FAILED);
    expect(ids).not.toContain(OLD_QUEUED);

    await db.delete(taskAttempts);
    await db.delete(tasks);
  });

  it('lists cleanup refs and detaches runtime session children', async () => {
    const TASK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
    const CHILD_TASK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
    const PARENT_SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
    const CHILD_SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';

    await seedTask({
      id: TASK_ID,
      status: 'completed',
      claimExpiresAt: null,
      completedAt: new Date('2026-04-26T10:00:00Z'),
      createAttempt: true,
      attemptStatus: 'completed',
    });
    await seedTask({
      id: CHILD_TASK_ID,
      status: 'completed',
      claimExpiresAt: null,
      completedAt: new Date('2026-04-26T10:00:00Z'),
      createAttempt: true,
      attemptStatus: 'completed',
    });
    await db.insert(taskArtifacts).values({
      teamId: TEAM_ID,
      taskId: TASK_ID,
      attemptN: 1,
      kind: 'json',
      title: 'result.json',
      objectKey: `teams/${TEAM_ID}/artifacts/result.json`,
      contentType: 'application/json',
      sizeBytes: 123,
      sha256: 'a'.repeat(64),
      cid: 'bafkreicleanup',
      createdByAgentId: AGENT_ID,
    });
    await db.insert(runtimeSessions).values([
      {
        id: PARENT_SESSION_ID,
        teamId: TEAM_ID,
        taskId: TASK_ID,
        attemptN: 1,
        sessionKind: 'root',
        objectKey: `teams/${TEAM_ID}/sessions/root.jsonl.gz`,
        contentType: 'application/x-ndjson',
        contentEncoding: 'gzip',
        sizeBytes: 456,
        sha256: 'b'.repeat(64),
        storageClass: 'runtime-session',
      },
      {
        id: CHILD_SESSION_ID,
        teamId: TEAM_ID,
        taskId: CHILD_TASK_ID,
        attemptN: 1,
        sessionKind: 'fork',
        parentSessionId: PARENT_SESSION_ID,
        objectKey: `teams/${TEAM_ID}/sessions/fork.jsonl.gz`,
        contentType: 'application/x-ndjson',
        contentEncoding: 'gzip',
        sizeBytes: 789,
        sha256: 'c'.repeat(64),
        storageClass: 'runtime-session',
      },
    ]);

    await expect(
      artifactRepo.listCleanupRefsForTasks([TASK_ID]),
    ).resolves.toEqual([
      expect.objectContaining({
        taskId: TASK_ID,
        objectKey: `teams/${TEAM_ID}/artifacts/result.json`,
        sizeBytes: 123,
      }),
    ]);
    await expect(
      runtimeSessionRepo.listCleanupRefsForTasks([TASK_ID]),
    ).resolves.toEqual([
      expect.objectContaining({
        id: PARENT_SESSION_ID,
        taskId: TASK_ID,
        objectKey: `teams/${TEAM_ID}/sessions/root.jsonl.gz`,
        sizeBytes: 456,
      }),
    ]);

    await runtimeSessionRepo.detachChildren([PARENT_SESSION_ID]);
    const [child] = await db
      .select()
      .from(runtimeSessions)
      .where(eq(runtimeSessions.id, CHILD_SESSION_ID));
    expect(child.parentSessionId).toBeNull();

    await db.delete(taskArtifacts);
    await db.delete(runtimeSessions);
    await db.delete(taskAttempts);
    await db.delete(tasks);
  });

  it('detaches child runtime sessions before deleting locked task rows', async () => {
    const PARENT_TASK_ID = '77777777-7777-4777-8777-777777777701';
    const CHILD_TASK_ID = '77777777-7777-4777-8777-777777777702';
    const PARENT_SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd11';
    const CHILD_SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd12';

    await seedTask({
      id: PARENT_TASK_ID,
      status: 'queued',
      claimExpiresAt: null,
      createAttempt: true,
      attemptStatus: 'claimed',
    });
    await seedTask({
      id: CHILD_TASK_ID,
      status: 'completed',
      claimExpiresAt: null,
      completedAt: new Date('2026-04-26T10:00:00Z'),
      createAttempt: true,
      attemptStatus: 'completed',
    });
    await db.insert(runtimeSessions).values([
      {
        id: PARENT_SESSION_ID,
        teamId: TEAM_ID,
        taskId: PARENT_TASK_ID,
        attemptN: 1,
        sessionKind: 'root',
        objectKey: `teams/${TEAM_ID}/sessions/locked-root.jsonl.gz`,
        contentType: 'application/x-ndjson',
        contentEncoding: 'gzip',
        sizeBytes: 456,
        sha256: 'd'.repeat(64),
        storageClass: 'runtime-session',
      },
      {
        id: CHILD_SESSION_ID,
        teamId: TEAM_ID,
        taskId: CHILD_TASK_ID,
        attemptN: 1,
        sessionKind: 'fork',
        parentSessionId: PARENT_SESSION_ID,
        objectKey: `teams/${TEAM_ID}/sessions/locked-fork.jsonl.gz`,
        contentType: 'application/x-ndjson',
        contentEncoding: 'gzip',
        sizeBytes: 789,
        sha256: 'e'.repeat(64),
        storageClass: 'runtime-session',
      },
    ]);

    const deletedIds = await transactionRunner.runInTransaction(async () => {
      const lockedIds = await repo.lockIdsIfStatusIn(
        [PARENT_TASK_ID],
        ['waiting', 'queued'],
      );
      expect(lockedIds).toEqual([PARENT_TASK_ID]);

      await runtimeSessionRepo.detachChildren([PARENT_SESSION_ID]);
      return repo.deleteManyIfStatusIn(lockedIds, ['waiting', 'queued']);
    });

    expect(deletedIds).toEqual([PARENT_TASK_ID]);
    const [child] = await db
      .select()
      .from(runtimeSessions)
      .where(eq(runtimeSessions.id, CHILD_SESSION_ID));
    expect(child.parentSessionId).toBeNull();

    await db.delete(runtimeSessions);
    await db.delete(taskAttempts);
    await db.delete(tasks);
  });
});
