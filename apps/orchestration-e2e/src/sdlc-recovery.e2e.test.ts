import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { createConvergenceApp, SDLC_CONVERGENCE_TASK } from '@moltnet/sdlc';
import { Client } from 'pg';
import { expect, it } from 'vitest';

const databaseUrl = process.env.ORCHESTRATION_ABSURD_URL as string;

function waitForLine(
  child: ChildProcessWithoutNullStreams,
  prefix: string,
): Promise<string> {
  return new Promise((resolveLine, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${prefix}: ${errors}`)),
      35_000,
    );
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const line = output.split('\n').find((item) => item.startsWith(prefix));
      if (line) {
        clearTimeout(timer);
        resolveLine(line);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      if (!output.split('\n').some((line) => line.startsWith(prefix)))
        reject(new Error(`Worker exited: ${errors}`));
    });
  });
}
async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => {
    child.once('exit', () => resolveExit());
  });
  child.kill('SIGKILL');
  await exited;
}

it('recovers the SDLC app after SIGKILL between external repair creation and checkpoint persistence', async () => {
  const queueName = `sdlc-recovery-${randomUUID()}`;
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const app = createConvergenceApp({
    databaseUrl,
    queueName,
    port: () => {
      throw new Error('Client does not execute tasks');
    },
  });
  const children: ChildProcessWithoutNullStreams[] = [];
  try {
    await db.query(
      'CREATE TABLE IF NOT EXISTS sdlc_recovery_repairs (run_key text NOT NULL, operation_key text NOT NULL, completed boolean NOT NULL, PRIMARY KEY (run_key,operation_key))',
    );
    await app.createQueue(queueName);
    const task = await app.spawn(
      SDLC_CONVERGENCE_TASK,
      {
        changeKey: 'example/repo#42',
        policy: {
          maxRepairRounds: 2,
          pollIntervalSec: 1,
          evidenceTimeoutSec: 30,
          repairTimeoutSec: 30,
        },
      },
      { queue: queueName },
    );
    const start = (mode: string) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(import.meta.dirname, 'fixtures/sdlc-recovery-worker.ts'),
        ],
        {
          env: {
            ...process.env,
            ORCHESTRATION_ABSURD_URL: databaseUrl,
            SDLC_RECOVERY_QUEUE: queueName,
            SDLC_RECOVERY_TASK: task.taskID,
            SDLC_RECOVERY_MODE: mode,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      children.push(child);
      return child;
    };
    const initial = start('initial');
    await waitForLine(initial, 'EFFECT_WRITTEN');
    await stop(initial);
    const replacement = start('recovery');
    const line = await waitForLine(replacement, 'RESULT ');
    const result: unknown = JSON.parse(line.slice('RESULT '.length));
    expect(result).toMatchObject({
      state: 'completed',
      result: { verdict: { status: 'ready' }, published: true },
    });
    const effects = await db.query<{ completed: boolean }>(
      'SELECT completed FROM sdlc_recovery_repairs WHERE run_key=$1',
      [queueName],
    );
    expect(effects.rows).toEqual([{ completed: true }]);
  } finally {
    await Promise.all(children.map(stop));
    await app.dropQueue(queueName);
    await app.close();
    await db.query('DELETE FROM sdlc_recovery_repairs WHERE run_key=$1', [
      queueName,
    ]);
    await db.end();
  }
}, 60_000);
