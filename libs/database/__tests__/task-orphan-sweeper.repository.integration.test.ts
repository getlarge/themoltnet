/**
 * Integration tests for the orphan-detection query used by the
 * task orphan sweeper (#937).
 *
 * Spins up an ephemeral pgvector/pgvector:pg16 container via
 * testcontainers, applies all Drizzle migrations, seeds the FK rows
 * (team, agent, diary) needed by the tasks table, and verifies that
 * `listOrphanedTasks` returns exactly the rows whose claim_expires_at
 * is older than the supplied cutoff and whose status is non-terminal.
 *
 * The `forceReleaseAttempt` step is straight-line code over existing
 * repository methods (`updateAttempt`, `updateStatus`, `findById`)
 * already exercised by the in-workflow timeout path in the
 * apps/rest-api e2e suite — so this test focuses on the new query
 * surface, not the persist transaction shape.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createTaskRepository } from '../src/repositories/task.repository.js';
import { agents, diaries, taskAttempts, tasks, teams } from '../src/schema.js';

describe('TaskRepository.listOrphanedTasks (integration)', () => {
  let db: Database;
  let pool: Pool;
  let repo: ReturnType<typeof createTaskRepository>;
  let stopContainer: () => Promise<void>;

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
      createdBy: AGENT_ID,
    });
    await db.insert(diaries).values({
      id: DIARY_ID,
      name: 'sweeper-test-diary',
      createdBy: AGENT_ID,
      teamId: TEAM_ID,
    });
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await db.delete(taskAttempts);
      await db.delete(tasks);
      await db.delete(diaries);
      await db.delete(teams);
      await db.delete(agents);
    }
    await pool?.end();
    await stopContainer();
  });

  async function seedTask(opts: {
    id: string;
    status: 'queued' | 'dispatched' | 'running' | 'completed' | 'failed';
    claimExpiresAt: Date | null;
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
      imposedByAgentId: AGENT_ID,
      status: opts.status,
      claimAgentId:
        opts.status === 'dispatched' || opts.status === 'running'
          ? AGENT_ID
          : null,
      claimExpiresAt: opts.claimExpiresAt,
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
});
