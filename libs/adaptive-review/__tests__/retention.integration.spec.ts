import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeAdaptiveStage, executionQueue } from '../src/execution.js';
import { cleanupReviewExecutions } from '../src/retention.js';

const databaseUrl = process.env.ADAPTIVE_TEST_DATABASE_URL as string;

describe('review retention (real Absurd/Postgres)', () => {
  let client: Client;
  const ids: string[] = [];
  const newId = () => {
    const id = `retention-test-${randomUUID()}`;
    ids.push(id);
    return id;
  };
  const stage = (executionId: string, published = false) =>
    executeAdaptiveStage({
      databaseUrl,
      executionId,
      stage: published ? 'publish' : 'review',
      input: { head: 'pinned' },
      run: async () => ({ taskId: 'original-task' }),
    });
  const age = (id: string, days: number) =>
    client.query(
      `UPDATE public.adaptive_review_retention SET last_used_at = clock_timestamp() - make_interval(days => $2)
     WHERE queue_name = $1`,
      [executionQueue(id), days],
    );
  const queues = async (id: string) =>
    (
      await client.query<{ queue_name: string }>(
        'SELECT queue_name FROM absurd.list_queues() WHERE queue_name = $1 OR queue_name = $2 ORDER BY queue_name',
        [executionQueue(id), `${executionQueue(id)}-input`],
      )
    ).rows.map((row) => row.queue_name);

  beforeEach(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });
  afterEach(async () => {
    for (const id of ids.splice(0)) {
      await client.query('SELECT absurd.drop_queue($1)', [executionQueue(id)]);
      await client.query('SELECT absurd.drop_queue($1)', [
        `${executionQueue(id)}-input`,
      ]);
      await client.query(
        'DELETE FROM public.adaptive_review_retention WHERE queue_name = $1',
        [executionQueue(id)],
      );
    }
    await client.end();
  });

  it('dry-runs without deleting checkpoints; applies 30/90 day cutoffs and preserves unrelated queues', async () => {
    const completed = newId(),
      unfinished = newId(),
      recent = newId(),
      failed = newId();
    await stage(completed, true);
    await stage(unfinished);
    await stage(recent, true);
    await stage(failed);
    await age(completed, 31);
    await age(unfinished, 31);
    await age(recent, 29);
    await age(failed, 91);
    const unrelated = `retention-unrelated-${randomUUID().replaceAll('-', '')}`;
    await client.query('SELECT absurd.create_queue($1)', [unrelated]);
    try {
      const dry = await cleanupReviewExecutions({ databaseUrl });
      expect(dry).toEqual(
        expect.arrayContaining([
          { queueName: executionQueue(completed), outcome: 'would-expire' },
          { queueName: executionQueue(failed), outcome: 'would-expire' },
        ]),
      );
      expect(await queues(completed)).toHaveLength(2);
      const applied = await cleanupReviewExecutions({
        databaseUrl,
        apply: true,
      });
      expect(applied).toHaveLength(2);
      expect(applied.every((row) => row.outcome === 'expired')).toBe(true);
      expect(await queues(completed)).toEqual([]);
      expect(await queues(failed)).toEqual([]);
      expect(await queues(unfinished)).toHaveLength(2);
      expect(await queues(recent)).toHaveLength(2);
      expect(
        (
          await client.query(
            'SELECT 1 FROM absurd.list_queues() WHERE queue_name = $1',
            [unrelated],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        await cleanupReviewExecutions({ databaseUrl, apply: true }),
      ).toEqual([]);
    } finally {
      await client.query('SELECT absurd.drop_queue($1)', [unrelated]);
    }
  });

  it('rejects an expired execution before submitting work; a fresh ID starts a new review', async () => {
    const id = newId();
    await stage(id, true);
    await age(id, 31);
    await cleanupReviewExecutions({ databaseUrl, apply: true });
    let submissions = 0;
    const run = async () => {
      submissions++;
      return 'submitted';
    };
    await expect(
      executeAdaptiveStage({
        databaseUrl,
        executionId: id,
        stage: 'review',
        input: {},
        run,
      }),
    ).rejects.toThrow('execution expired');
    expect(submissions).toBe(0);
    expect(await queues(id)).toEqual([]);
    await executeAdaptiveStage({
      databaseUrl,
      executionId: newId(),
      stage: 'review',
      input: {},
      run,
    });
    expect(submissions).toBe(1);
  });

  it('replays retained results with the same task IDs and no replacement submissions', async () => {
    const id = newId();
    let submissions = 0;
    const args = {
      databaseUrl,
      executionId: id,
      stage: 'review' as const,
      input: {},
      run: async () => {
        submissions++;
        return { taskId: randomUUID(), spent: 3, repairs: 1 };
      },
    };
    const original = await executeAdaptiveStage(args);
    await age(id, 89);
    await cleanupReviewExecutions({ databaseUrl, apply: true });
    expect(await executeAdaptiveStage(args)).toEqual(original);
    expect(submissions).toBe(1);
  });

  it('skips an active coordinator even when its record is old', async () => {
    const id = newId();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execution = executeAdaptiveStage({
      databaseUrl,
      executionId: id,
      stage: 'review',
      input: {},
      run: async () => {
        entered();
        await gate;
        return { ok: true };
      },
    });
    try {
      await started;
      await age(id, 100);
      expect(
        await cleanupReviewExecutions({ databaseUrl, apply: true }),
      ).toContainEqual({ queueName: executionQueue(id), outcome: 'active' });
      expect(await queues(id)).toHaveLength(2);
    } finally {
      release();
      await execution;
    }
    expect(await cleanupReviewExecutions({ databaseUrl, apply: true })).toEqual(
      [],
    );
  });

  it('rolls back both queue drops if committing the expiry record fails', async () => {
    const id = newId();
    await stage(id, true);
    await age(id, 31);
    // Failure occurs AFTER both drop_queue calls, on the same real transaction.
    await client.query(`CREATE FUNCTION pg_temp.reject_review_expiry() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'injected expiry failure'; END $$`);
    await client.query(`CREATE TRIGGER reject_review_expiry BEFORE UPDATE OF expired_at
      ON public.adaptive_review_retention FOR EACH ROW
      WHEN (NEW.queue_name = '${executionQueue(id)}') EXECUTE FUNCTION pg_temp.reject_review_expiry()`);
    try {
      await expect(
        cleanupReviewExecutions({ databaseUrl, apply: true }),
      ).rejects.toThrow('injected expiry failure');
      expect(await queues(id)).toHaveLength(2);
      expect(
        (
          await client.query(
            'SELECT expired_at FROM public.adaptive_review_retention WHERE queue_name = $1',
            [executionQueue(id)],
          )
        ).rows[0].expired_at,
      ).toBeNull();
      expect(await stage(id, true)).toEqual({ taskId: 'original-task' });
    } finally {
      await client.query(
        'DROP TRIGGER reject_review_expiry ON public.adaptive_review_retention',
      );
    }
  });

  it('bounds cleanup batches and rejects policy changes from a caller', async () => {
    const first = newId(),
      second = newId();
    await stage(first, true);
    await stage(second, true);
    await age(first, 40);
    await age(second, 35);
    await expect(
      cleanupReviewExecutions({
        databaseUrl,
        policy: { completedDays: 60, unfinishedDays: 90 },
        apply: true,
      }),
    ).rejects.toThrow('differs from the database policy');
    expect(
      await cleanupReviewExecutions({ databaseUrl, limit: 1, apply: true }),
    ).toEqual([{ queueName: executionQueue(first), outcome: 'expired' }]);
    expect(await queues(second)).toHaveLength(2);
    expect(
      await cleanupReviewExecutions({ databaseUrl, limit: 1, apply: true }),
    ).toEqual([{ queueName: executionQueue(second), outcome: 'expired' }]);
  });

  it('serializes concurrent cleanup and resume without recreating expired queues', async () => {
    const id = newId();
    await stage(id, true);
    await age(id, 31);
    await client.query('SELECT pg_advisory_lock(2989, 1)');
    await client.query(`CREATE FUNCTION pg_temp.pause_review_expiry() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN PERFORM pg_advisory_xact_lock(2989, 1); RETURN NEW; END $$`);
    await client.query(`CREATE TRIGGER pause_review_expiry BEFORE UPDATE OF expired_at
      ON public.adaptive_review_retention FOR EACH ROW
      WHEN (NEW.queue_name = '${executionQueue(id)}') EXECUTE FUNCTION pg_temp.pause_review_expiry()`);
    const cleaning = cleanupReviewExecutions({ databaseUrl, apply: true });
    let resume: Promise<unknown> | undefined;
    try {
      await vi.waitFor(async () => {
        const blocked = await client.query(`SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND classid = 2989 AND objid = 1 AND NOT granted`);
        expect(blocked.rowCount).toBe(1);
      });
      // Cleaner has dropped both queues within its uncommitted transaction.
      // Resume must wait for its lock, then observe the tombstone.
      resume = stage(id, true).then(
        () => 'unexpected success',
        (error: unknown) => error,
      );
      await client.query('SELECT pg_advisory_unlock(2989, 1)');
      expect(await cleaning).toContainEqual({
        queueName: executionQueue(id),
        outcome: 'expired',
      });
      expect(await resume).toBeInstanceOf(Error);
      expect(String(await resume)).toContain('execution expired');
      expect(await queues(id)).toEqual([]);
    } finally {
      await client.query('SELECT pg_advisory_unlock(2989, 1)');
      await cleaning;
      await resume;
      await client.query(
        'DROP TRIGGER pause_review_expiry ON public.adaptive_review_retention',
      );
    }
  });

  it('releases the active lock after process death and expires an abandoned execution', async () => {
    const id = newId();
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve(import.meta.dirname, 'fixtures/retention-worker.ts'),
      ],
      {
        env: { ...process.env, ADAPTIVE_TEST_EXECUTION_ID: id },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    try {
      await vi.waitFor(
        () => {
          expect(child.exitCode, stderr).toBeNull();
          expect(stdout).toContain('RETENTION_WORKER_READY');
        },
        { timeout: 15000 },
      );
      await age(id, 100);
      expect(
        await cleanupReviewExecutions({ databaseUrl, apply: true }),
      ).toContainEqual({ queueName: executionQueue(id), outcome: 'active' });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    }
    await vi.waitFor(async () => {
      expect(
        await cleanupReviewExecutions({ databaseUrl, apply: true }),
      ).toContainEqual({ queueName: executionQueue(id), outcome: 'expired' });
    });
    expect(await queues(id)).toEqual([]);
    await expect(stage(id)).rejects.toThrow('execution expired');
  });

  it('runs the cleanup CLI without GitHub or model credentials, with dry run as default', async () => {
    const id = newId();
    await stage(id, true);
    await age(id, 31);
    const command = (apply?: string) =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', resolve(import.meta.dirname, '../src/main.ts')],
        {
          env: {
            PATH: process.env.PATH,
            ADAPTIVE_STAGE: 'cleanup',
            ADAPTIVE_DATABASE_URL: databaseUrl,
            ...(apply === undefined ? {} : { ADAPTIVE_CLEANUP_APPLY: apply }),
          },
        },
      );
    const dry = await command();
    expect(JSON.parse(dry.stdout)).toContainEqual({
      queueName: executionQueue(id),
      outcome: 'would-expire',
    });
    expect(await queues(id)).toHaveLength(2);
    await expect(command('yes')).rejects.toThrow(
      'ADAPTIVE_CLEANUP_APPLY must be true or false',
    );
    const applied = await command('true');
    expect(JSON.parse(applied.stdout)).toContainEqual({
      queueName: executionQueue(id),
      outcome: 'expired',
    });
    expect(await queues(id)).toEqual([]);
  });

  it('rejects a second repository with a shorter policy before any work or deletion', async () => {
    const existing = newId();
    await stage(existing);
    await age(existing, 10);
    let submissions = 0;
    await expect(
      executeAdaptiveStage({
        databaseUrl,
        executionId: newId(),
        stage: 'prepare',
        input: { repo: 'another/project' },
        retention: { completedDays: 1, unfinishedDays: 1 },
        run: async () => {
          submissions++;
          return {};
        },
      }),
    ).rejects.toThrow('differs from the database policy');
    await expect(
      cleanupReviewExecutions({
        databaseUrl,
        apply: true,
        policy: { completedDays: 1, unfinishedDays: 1 },
      }),
    ).rejects.toThrow('differs from the database policy');
    expect(submissions).toBe(0);
    expect(await queues(existing)).toHaveLength(2);
    expect(await stage(existing)).toEqual({ taskId: 'original-task' });
  });

  it('uses an explicit database-owner policy change and rejects stale callers', async () => {
    const id = newId();
    await stage(id, true);
    await age(id, 40);
    // Administrative change, not a stage/cleanup input override.
    await client.query(
      'UPDATE public.adaptive_review_retention_policy SET completed_days = 60 WHERE singleton',
    );
    try {
      await expect(
        cleanupReviewExecutions({ databaseUrl, apply: true }),
      ).rejects.toThrow('differs from the database policy');
      expect(
        await cleanupReviewExecutions({
          databaseUrl,
          apply: true,
          policy: { completedDays: 60, unfinishedDays: 90 },
        }),
      ).toEqual([]);
      expect(await queues(id)).toHaveLength(2);
    } finally {
      await client.query(
        'UPDATE public.adaptive_review_retention_policy SET completed_days = 30 WHERE singleton',
      );
    }
  });

  it('preparation automatically sweeps expired executions', async () => {
    const old = newId();
    await stage(old, true);
    await age(old, 31);
    await executeAdaptiveStage({
      databaseUrl,
      executionId: newId(),
      stage: 'prepare',
      input: {},
      run: async () => ({ prepared: true }),
    });
    expect(await queues(old)).toEqual([]);
  });
});
