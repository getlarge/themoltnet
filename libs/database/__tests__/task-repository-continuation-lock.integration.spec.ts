/**
 * Integration test for `tryAcquireContinuationLock` (#1287, Task 11).
 *
 * Spins up an ephemeral pgvector/pgvector:pg16 container, applies all
 * Drizzle migrations, and verifies that the non-blocking advisory lock:
 *  - is acquired by the first transaction to ask,
 *  - returns false (does NOT block) for a concurrent transaction
 *    targeting the same parent (taskId, attemptN),
 *  - permits concurrent transactions against *different* parents,
 *  - auto-releases on commit/rollback.
 *
 * Mirrors the testcontainers setup used by
 * `task-orphan-sweeper.repository.integration.test.ts`. We do NOT seed
 * task rows because the lock keys are arbitrary strings hashed via
 * `hashtextextended` — no FK dependency.
 *
 * Concurrent transactions: we open a Drizzle `db.transaction(cb)` and
 * keep its `cb` parked on a Promise so the transaction stays open while
 * a sibling transaction tries the same key. Once we read the loser's
 * result, we resolve the parked Promise to release.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createTaskRepository } from '../src/repositories/task.repository.js';
import { createDrizzleTransactionRunner } from '../src/transaction-context.js';

describe('TaskRepository.tryAcquireContinuationLock (integration)', () => {
  let db: Database;
  let pool: Pool;
  let repo: ReturnType<typeof createTaskRepository>;
  let runner: ReturnType<typeof createDrizzleTransactionRunner>;
  let stopContainer: () => Promise<void>;

  const PARENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const PARENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
    runner = createDrizzleTransactionRunner(db);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await stopContainer?.();
  });

  it('returns true for the first caller inside a transaction', async () => {
    const acquired = await runner.runInTransaction(() =>
      repo.tryAcquireContinuationLock(PARENT_A, 1),
    );
    expect(acquired).toBe(true);
  });

  it('throws if called outside any transaction', async () => {
    await expect(repo.tryAcquireContinuationLock(PARENT_A, 1)).rejects.toThrow(
      /must be called inside a TransactionRunner-managed/,
    );
  });

  it('returns false for a concurrent caller against the same parent', async () => {
    // Hold a transaction open across the whole concurrent-call window.
    let release!: () => void;
    const releaseSignal = new Promise<void>((res) => {
      release = res;
    });
    let firstAcquired: boolean | undefined;
    let firstEntered!: () => void;
    const firstEnteredSignal = new Promise<void>((res) => {
      firstEntered = res;
    });

    const heldTxPromise = runner.runInTransaction(async () => {
      firstAcquired = await repo.tryAcquireContinuationLock(PARENT_A, 7);
      firstEntered();
      await releaseSignal;
    });

    await firstEnteredSignal;
    expect(firstAcquired).toBe(true);

    // Concurrent transaction tries the same key — should NOT block,
    // should return false immediately.
    const losingResult = await runner.runInTransaction(() =>
      repo.tryAcquireContinuationLock(PARENT_A, 7),
    );
    expect(losingResult).toBe(false);

    release();
    await heldTxPromise;
  });

  it('returns true for concurrent callers against different parents', async () => {
    let release!: () => void;
    const releaseSignal = new Promise<void>((res) => {
      release = res;
    });
    let firstEntered!: () => void;
    const firstEnteredSignal = new Promise<void>((res) => {
      firstEntered = res;
    });

    const heldTxPromise = runner.runInTransaction(async () => {
      const ok = await repo.tryAcquireContinuationLock(PARENT_A, 3);
      expect(ok).toBe(true);
      firstEntered();
      await releaseSignal;
    });

    await firstEnteredSignal;

    const otherResult = await runner.runInTransaction(() =>
      repo.tryAcquireContinuationLock(PARENT_B, 3),
    );
    expect(otherResult).toBe(true);

    release();
    await heldTxPromise;
  });

  it('different attempt numbers of the same parent do not contend', async () => {
    let release!: () => void;
    const releaseSignal = new Promise<void>((res) => {
      release = res;
    });
    let firstEntered!: () => void;
    const firstEnteredSignal = new Promise<void>((res) => {
      firstEntered = res;
    });

    const heldTxPromise = runner.runInTransaction(async () => {
      const ok = await repo.tryAcquireContinuationLock(PARENT_A, 1);
      expect(ok).toBe(true);
      firstEntered();
      await releaseSignal;
    });

    await firstEnteredSignal;

    const otherResult = await runner.runInTransaction(() =>
      repo.tryAcquireContinuationLock(PARENT_A, 2),
    );
    expect(otherResult).toBe(true);

    release();
    await heldTxPromise;
  });

  it('auto-releases the lock when the transaction commits', async () => {
    // First tx acquires + commits.
    await runner.runInTransaction(() =>
      repo.tryAcquireContinuationLock(PARENT_A, 99),
    );
    // A subsequent tx must then be able to acquire the same key.
    const reacquired = await runner.runInTransaction(() =>
      repo.tryAcquireContinuationLock(PARENT_A, 99),
    );
    expect(reacquired).toBe(true);
  });
});
