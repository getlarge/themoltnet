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
      });
      await waitForOutput(initialWorker, 'CHECKPOINTED');

      initialWorker.kill('SIGKILL');
      await waitForExit(initialWorker);

      recoveryWorker = startWorkerProcess({
        queueName,
        taskId: spawned.taskID,
        runKey,
        mode: 'recovery',
      });
      const resultLine = await waitForOutput(recoveryWorker, 'RESULT ');
      await waitForExit(recoveryWorker);

      const result = JSON.parse(resultLine.slice('RESULT '.length)) as {
        state: string;
        result?: { recovered?: boolean; runKey?: string };
      };
      expect(result).toEqual({
        state: 'completed',
        result: { recovered: true, runKey },
      });
      const effects = await database.query<{ calls: number }>(
        'SELECT calls FROM orchestration_recovery_effects WHERE run_key = $1',
        [runKey],
      );
      expect(effects.rows).toEqual([{ calls: 1 }]);
    } finally {
      initialWorker?.kill('SIGKILL');
      recoveryWorker?.kill('SIGKILL');
      await database.query(
        'DELETE FROM orchestration_recovery_effects WHERE run_key = $1',
        [runKey],
      );
      await client.dropQueue(queueName).catch(() => undefined);
      await client.close();
      await database.end();
    }
  }, 60_000);
});
