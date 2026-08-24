import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { createOrchestrationAbsurdApp } from '@themoltnet/tasks-orchestrator';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const ABSURD_URL = process.env.ORCHESTRATION_ABSURD_URL as string;
const WORKER_FIXTURE = resolve(
  import.meta.dirname,
  'fixtures/process-recovery-worker.ts',
);

function startWorkerProcess(args: {
  queueName: string;
  taskId: string;
  runKey: string;
  mode: 'initial' | 'recovery';
  scenario: 'checkpoint' | 'validated-repair';
}): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ['--import', 'tsx', WORKER_FIXTURE], {
    cwd: resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      ORCHESTRATION_ABSURD_URL: ABSURD_URL,
      ORCHESTRATION_RECOVERY_QUEUE: args.queueName,
      ORCHESTRATION_RECOVERY_TASK_ID: args.taskId,
      ORCHESTRATION_RECOVERY_RUN_KEY: args.runKey,
      ORCHESTRATION_RECOVERY_MODE: args.mode,
      ORCHESTRATION_RECOVERY_SCENARIO: args.scenario,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  prefix: string,
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      reject(
        new Error(
          `worker did not emit ${prefix}; stdout=${stdout}; stderr=${stderr}`,
        ),
      );
    }, timeoutMs);
    const finish = (value: string) => {
      clearTimeout(timer);
      resolveOutput(value);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const line = stdout
        .split('\n')
        .find((candidate) => candidate.startsWith(prefix));
      if (line) finish(line);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('exit', (code, signal) => {
      if (!stdout.split('\n').some((line) => line.startsWith(prefix))) {
        clearTimeout(timer);
        reject(
          new Error(
            `worker exited before ${prefix} (code=${String(code)}, signal=${String(signal)}); stderr=${stderr}`,
          ),
        );
      }
    });
  });
}

async function waitForExit(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveExit) => {
    child.once('exit', () => resolveExit());
  });
}

describe('orchestration process recovery (real Absurd)', () => {
  it('replays a completed checkpoint after the worker process is killed and replaced', async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const queueName = `orchestration-recovery-${suffix}`;
    const runKey = randomUUID();
    const database = new Client({ connectionString: ABSURD_URL });
    await database.connect();
    await database.query(`
      CREATE TABLE IF NOT EXISTS orchestration_recovery_effects (
        run_key text PRIMARY KEY,
        calls integer NOT NULL
      )
    `);
    await database.query(`
      CREATE TABLE IF NOT EXISTS orchestration_recovery_children (
        run_key text NOT NULL,
        branch text NOT NULL,
        calls integer NOT NULL,
        execution_id text NOT NULL,
        checkpoint_name text NOT NULL,
        idempotency_key text NOT NULL,
        PRIMARY KEY (run_key, branch)
      )
    `);

    const client = createOrchestrationAbsurdApp<{ runKey: string }>({
      databaseUrl: ABSURD_URL,
      queueName,
      taskName: 'process_recovery',
      run: () => Promise.resolve({ clientOnly: true }),
    });
    let initialWorker: ChildProcessWithoutNullStreams | null = null;
    let recoveryWorker: ChildProcessWithoutNullStreams | null = null;

    try {
      await client.createQueue(queueName);
      const spawned = await client.spawn(
        'process_recovery',
        { runKey },
        {
          queue: queueName,
          idempotencyKey: `process-recovery:${runKey}`,
        },
      );

      initialWorker = startWorkerProcess({
        queueName,
        taskId: spawned.taskID,
        runKey,
        mode: 'initial',
        scenario: 'checkpoint',
      });
      await waitForOutput(initialWorker, 'CHECKPOINTED');

      initialWorker.kill('SIGKILL');
      await waitForExit(initialWorker);

      recoveryWorker = startWorkerProcess({
        queueName,
        taskId: spawned.taskID,
        runKey,
        mode: 'recovery',
        scenario: 'checkpoint',
      });
      const resultLine = await waitForOutput(recoveryWorker, 'RESULT ');
      await waitForExit(recoveryWorker);

      const result = JSON.parse(resultLine.slice('RESULT '.length)) as {
        state: string;
        result?: {
          recovered?: boolean;
          runKey?: string;
          executionId?: string;
          children?: Array<{
            branch: string;
            stepName: string;
            idempotencyKey: string;
          }>;
        };
      };
      expect(result.state).toBe('completed');
      expect(result.result).toMatchObject({
        recovered: true,
        runKey,
        executionId: spawned.taskID,
      });
      expect(result.result?.children?.map((child) => child.stepName)).toEqual([
        'child.create',
        'child.create#2',
      ]);
      expect(
        new Set(
          result.result?.children?.map((child) => child.idempotencyKey) ?? [],
        ).size,
      ).toBe(2);
      const effects = await database.query<{ calls: number }>(
        'SELECT calls FROM orchestration_recovery_effects WHERE run_key = $1',
        [runKey],
      );
      expect(effects.rows).toEqual([{ calls: 1 }]);
      const children = await database.query<{
        branch: string;
        calls: number;
        execution_id: string;
        checkpoint_name: string;
        idempotency_key: string;
      }>(
        `SELECT branch, calls, execution_id, checkpoint_name, idempotency_key
         FROM orchestration_recovery_children
         WHERE run_key = $1
         ORDER BY branch`,
        [runKey],
      );
      expect(children.rows).toHaveLength(2);
      expect(children.rows.every((row) => row.calls === 1)).toBe(true);
      expect(
        children.rows.every((row) => row.execution_id === spawned.taskID),
      ).toBe(true);
      expect(new Set(children.rows.map((row) => row.checkpoint_name))).toEqual(
        new Set(['child.create', 'child.create#2']),
      );
      expect(
        new Set(children.rows.map((row) => row.idempotency_key)).size,
      ).toBe(2);
    } finally {
      initialWorker?.kill('SIGKILL');
      recoveryWorker?.kill('SIGKILL');
      await database.query(
        'DELETE FROM orchestration_recovery_effects WHERE run_key = $1',
        [runKey],
      );
      await database.query(
        'DELETE FROM orchestration_recovery_children WHERE run_key = $1',
        [runKey],
      );
      await client.dropQueue(queueName).catch(() => undefined);
      await client.close();
      await database.end();
    }
  }, 60_000);

  it('reconciles idempotent repair creation across the pre-checkpoint crash gap', async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const queueName = `validated-repair-recovery-${suffix}`;
    const runKey = randomUUID();
    const database = new Client({ connectionString: ABSURD_URL });
    await database.connect();
    await database.query(`
      CREATE TABLE IF NOT EXISTS orchestration_recovery_repairs (
        run_key text NOT NULL,
        idempotency_key text NOT NULL,
        task_id text NOT NULL,
        create_requests integer NOT NULL,
        PRIMARY KEY (run_key, idempotency_key)
      )
    `);

    const client = createOrchestrationAbsurdApp<{ runKey: string }>({
      databaseUrl: ABSURD_URL,
      queueName,
      taskName: 'process_recovery',
      run: () => Promise.resolve({ clientOnly: true }),
    });
    let initialWorker: ChildProcessWithoutNullStreams | null = null;
    let recoveryWorker: ChildProcessWithoutNullStreams | null = null;

    try {
      await client.createQueue(queueName);
      const spawned = await client.spawn(
        'process_recovery',
        { runKey },
        {
          queue: queueName,
          idempotencyKey: `validated-repair-recovery:${runKey}`,
        },
      );

      initialWorker = startWorkerProcess({
        queueName,
        taskId: spawned.taskID,
        runKey,
        mode: 'initial',
        scenario: 'validated-repair',
      });
      const createdLine = await waitForOutput(initialWorker, 'REPAIR_CREATED ');
      const [, repairTaskId, idempotencyKey] = createdLine.split(' ');
      expect(repairTaskId).toBeTruthy();
      expect(idempotencyKey).toMatch(/^absurd:/);

      initialWorker.kill('SIGKILL');
      await waitForExit(initialWorker);

      recoveryWorker = startWorkerProcess({
        queueName,
        taskId: spawned.taskID,
        runKey,
        mode: 'recovery',
        scenario: 'validated-repair',
      });
      const resultLine = await waitForOutput(recoveryWorker, 'RESULT ');
      await waitForExit(recoveryWorker);

      const result = JSON.parse(resultLine.slice('RESULT '.length)) as {
        state: string;
        result?: {
          kind?: string;
          result?: { task?: { id?: string }; state?: { phase?: string } };
          chain?: Array<{ repairN?: number }>;
          cumulativeUsage?: {
            inputTokens?: number;
            outputTokens?: number;
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
            toolCalls?: number;
          };
        };
      };
      expect(result.state).toBe('completed');
      expect(result.result).toMatchObject({
        kind: 'accepted',
        result: {
          task: { id: repairTaskId },
          state: { phase: 'repaired' },
        },
        chain: [{ repairN: 0 }, { repairN: 1 }],
        cumulativeUsage: {
          inputTokens: 10,
          outputTokens: 3,
          cacheReadTokens: 2,
          cacheWriteTokens: 3,
          toolCalls: 1,
        },
      });

      const repairs = await database.query<{
        task_id: string;
        idempotency_key: string;
        create_requests: number;
      }>(
        `SELECT task_id, idempotency_key, create_requests
         FROM orchestration_recovery_repairs
         WHERE run_key = $1`,
        [runKey],
      );
      expect(repairs.rows).toEqual([
        {
          task_id: repairTaskId,
          idempotency_key: idempotencyKey,
          create_requests: 2,
        },
      ]);
    } finally {
      initialWorker?.kill('SIGKILL');
      recoveryWorker?.kill('SIGKILL');
      await database.query(
        'DELETE FROM orchestration_recovery_repairs WHERE run_key = $1',
        [runKey],
      );
      await client.dropQueue(queueName).catch(() => undefined);
      await client.close();
      await database.end();
    }
  }, 60_000);
});
