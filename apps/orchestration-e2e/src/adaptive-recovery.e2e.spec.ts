import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  ADAPTIVE_STAGE_TASK,
  type AdaptiveReport,
  createAdaptiveStageApp,
  executeAdaptiveStage,
  executionQueue,
  type RunOptions,
} from '@moltnet/adaptive-review';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.ORCHESTRATION_ABSURD_URL as string;
function output(
  child: ChildProcessWithoutNullStreams,
  marker: string,
): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(
      () => reject(new Error(`missing ${marker}: ${stdout}\n${stderr}`)),
      30_000,
    );
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const line = stdout.split('\n').find((item) => item.startsWith(marker));
      if (line) {
        clearTimeout(timer);
        resolveOutput(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('exit', () => {
      clearTimeout(timer);
      if (!stdout.includes(marker))
        reject(new Error(`worker exited: ${stderr}`));
    });
  });
}
async function kill(child: ChildProcessWithoutNullStreams | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}
function pinnedInput(cwd: string): Omit<RunOptions, 'tasks' | 'ctx'> {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q');
  mkdirSync(join(cwd, '.github'));
  writeFileSync(
    join(cwd, '.github/adaptive-review.json'),
    JSON.stringify({
      version: 1,
      lanes: ['tests', 'conventions'],
      rules: [],
      checks: [],
    }),
  );
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  writeFileSync(join(cwd, 'example.ts'), 'export const value = 1;\n');
  const base = commit();
  writeFileSync(join(cwd, 'example.ts'), 'export const value = 2;\n');
  const head = commit();
  const budget = {
    runningTimeoutSec: 60,
    dispatchTimeoutSec: 60,
    expiresInSec: 120,
  };
  return {
    cwd,
    runtimeSha: base,
    mode: 'shadow',
    profiles: { focused: 'reviewer' },
    identity: {
      repo: 'another/project',
      pr: 7,
      title: 'Change value',
      body: '',
      base,
      head,
      correlationId: cwd,
      teamId: 'team',
      diaryId: 'diary',
      classifierProfileId: 'classifier',
    },
    taskBudgets: {
      classifier: budget,
      focused: budget,
      docs: budget,
      tests: budget,
      conventions: budget,
      complexity: budget,
      security: budget,
      performance: budget,
      'blast-radius': budget,
    },
  };
}

describe('adaptive review process recovery (real Absurd; SQL task-service fixture)', () => {
  it.each(['create', 'await', 'parallel', 'repair'])(
    'recovers %s without replacement tasks or renewed repair budgets',
    async (scenario) => {
      const cwd = mkdtempSync(join(tmpdir(), 'adaptive-process-'));
      const queueName = `adaptive-test-${process.pid}-${Date.now()}`;
      const database = new Client({ connectionString: databaseUrl });
      await database.connect();
      await database.query(`CREATE TABLE IF NOT EXISTS adaptive_recovery_submissions (
      queue text NOT NULL, key text NOT NULL, body jsonb NOT NULL, task jsonb NOT NULL,
      attempts jsonb NOT NULL, requests integer NOT NULL, PRIMARY KEY (queue, key))`);
      const app = createAdaptiveStageApp({
        databaseUrl,
        queueName,
        run: () => Promise.resolve(null),
      });
      let first: ChildProcessWithoutNullStreams | undefined;
      let second: ChildProcessWithoutNullStreams | undefined;
      try {
        await app.createQueue();
        const spawned = await app.spawn(ADAPTIVE_STAGE_TASK, {
          operation: 'run',
          input: pinnedInput(cwd),
        });
        const start = (initial: boolean) =>
          spawn(
            process.execPath,
            [
              '--import',
              'tsx',
              resolve(
                import.meta.dirname,
                'fixtures/adaptive-recovery-worker.ts',
              ),
            ],
            {
              env: {
                ...process.env,
                ADAPTIVE_TEST_QUEUE: queueName,
                ADAPTIVE_TEST_TASK: spawned.taskID,
                ADAPTIVE_TEST_SCENARIO: scenario,
                ADAPTIVE_TEST_INITIAL: String(initial),
              },
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          );
        first = start(true);
        await output(
          first,
          scenario === 'await'
            ? 'WAITING'
            : scenario === 'parallel'
              ? 'PARTIAL'
              : 'CREATED',
        );
        await kill(first);
        const before = await database.query<{ id: string }>(
          "SELECT task->>'id' AS id FROM adaptive_recovery_submissions WHERE queue = $1",
          [queueName],
        );
        second = start(false);
        const line = await output(second, 'RESULT ');
        const result = JSON.parse(line.slice(7)) as {
          state: string;
          result: AdaptiveReport;
        };
        expect(result.state).toBe('completed');
        const after = await database.query<{
          task: { id: string };
          requests: number;
          body: { tags: string[] };
        }>(
          'SELECT task, requests, body FROM adaptive_recovery_submissions WHERE queue = $1',
          [queueName],
        );
        expect(after.rows).toHaveLength(scenario === 'repair' ? 5 : 3);
        expect(after.rows.reduce((sum, row) => sum + row.requests, 0)).toBe(
          after.rows.length +
            (scenario === 'create' || scenario === 'repair' ? 1 : 0),
        );
        expect(new Set(result.result.taskIds)).toEqual(
          new Set(after.rows.map((row) => row.task.id)),
        );
        for (const { id } of before.rows)
          expect(result.result.taskIds).toContain(id);
        if (scenario === 'repair') {
          const failed = result.result.results.find(
            (lane) => lane.lane === 'tests',
          );
          expect(failed?.status).toBe('failed');
          expect(new Set(failed?.taskIds)).toEqual(
            new Set(
              after.rows
                .filter((row) => row.body.tags.includes('lane:tests'))
                .map((row) => row.task.id),
            ),
          );
        }
      } finally {
        await kill(first);
        await kill(second);
        await app.dropQueue();
        await app.close();
        await database.query(
          'DELETE FROM adaptive_recovery_submissions WHERE queue = $1',
          [queueName],
        );
        await database.end();
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it('binds input before execution, reuses a completed stage, and separates explicit new reviews', async () => {
    const executionId = `binding-${process.pid}-${Date.now()}`;
    let calls = 0;
    const run = (input: { head: string }) => {
      calls += 1;
      return Promise.resolve(input);
    };
    const args = {
      databaseUrl,
      executionId,
      stage: 'route' as const,
      input: { head: 'a'.repeat(40) },
      run,
    };
    try {
      expect(await executeAdaptiveStage(args)).toEqual(args.input);
      expect(await executeAdaptiveStage(args)).toEqual(args.input);
      await expect(
        executeAdaptiveStage({ ...args, input: { head: 'b'.repeat(40) } }),
      ).rejects.toThrow('incompatible pinned inputs');
      expect(calls).toBe(1);
      await executeAdaptiveStage({
        ...args,
        executionId: `${executionId}-new`,
      });
      expect(calls).toBe(2);
    } finally {
      for (const id of [executionId, `${executionId}-new`]) {
        for (const suffix of ['', '-input']) {
          const app = createAdaptiveStageApp({
            databaseUrl,
            queueName: executionQueue(id) + suffix,
            run,
          });
          await app.dropQueue();
          await app.close();
        }
      }
    }
  });
});
