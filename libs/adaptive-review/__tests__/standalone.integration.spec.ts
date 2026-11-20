import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';

import { Client } from 'pg';
import { expect, it } from 'vitest';

import { parseReviewTaskBudgets } from '../src/config.js';
import {
  ADAPTIVE_WORKFLOW_TASK,
  createAdaptiveWorkflowApp,
  workflowExecutionQueue,
} from '../src/execution.js';
import {
  runStandaloneReview,
  type StandaloneReviewInput,
  type StandaloneReviewResult,
  type StandaloneReviewServices,
} from '../src/standalone.js';
import { IdempotentReviewTasks, reviewFixture } from './recovery-fixture.js';

function marker(
  child: ChildProcessWithoutNullStreams,
  prefix: string,
): Promise<string> {
  return new Promise((resolveMarker, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(
      () => reject(new Error(`Missing ${prefix}: ${stdout}\n${stderr}`)),
      30_000,
    );
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      const line = stdout.split('\n').find((value) => value.startsWith(prefix));
      if (line) {
        clearTimeout(timer);
        resolveMarker(line);
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.once('exit', () => {
      clearTimeout(timer);
      if (!stdout.includes(prefix))
        reject(new Error(`Worker exited: ${stderr}`));
    });
  });
}
async function kill(child?: ChildProcessWithoutNullStreams) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

it('resumes one complete workflow in a replacement OS process after classification', async () => {
  const repo = reviewFixture();
  const databaseUrl = process.env.ADAPTIVE_TEST_DATABASE_URL as string;
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  await database.query(`CREATE TABLE IF NOT EXISTS adaptive_recovery_submissions (
    queue text NOT NULL, key text NOT NULL, body jsonb NOT NULL,
    task jsonb NOT NULL, attempts jsonb NOT NULL, requests integer NOT NULL,
    PRIMARY KEY (queue, key)
  )`);
  const correlationId = randomUUID();
  const queueName = workflowExecutionQueue(correlationId);
  const input: StandaloneReviewInput = {
    repo: 'another/project',
    pr: 7,
    correlationId,
    teamId: 'team',
    diaryId: 'diary',
    runtimeSha: repo.base,
    mode: 'shadow',
    profiles: { classifier: 'classifier', focused: 'reviewer' },
    taskBudgets: parseReviewTaskBudgets(),
    protectedPaths: [],
    appLogin: 'reviewer[bot]',
    publication: 'report-only',
    runUrl: 'https://example.com/review',
    inlineFindings: false,
  };
  const app = createAdaptiveWorkflowApp<
    StandaloneReviewInput,
    StandaloneReviewResult
  >({
    databaseUrl,
    queueName,
    run: async () => {
      throw new Error('Only the child worker may conduct the review');
    },
  });
  let first: ChildProcessWithoutNullStreams | undefined;
  let second: ChildProcessWithoutNullStreams | undefined;
  try {
    await app.createQueue();
    const task = await app.spawn(ADAPTIVE_WORKFLOW_TASK, {
      operation: 'run',
      input,
    });
    const start = (initial: boolean) =>
      spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(import.meta.dirname, 'fixtures/standalone-worker.ts'),
        ],
        {
          env: {
            ...process.env,
            ADAPTIVE_TEST_QUEUE: queueName,
            ADAPTIVE_TEST_TASK: task.taskID,
            ADAPTIVE_TEST_INITIAL: String(initial),
            ADAPTIVE_TEST_SCENARIO: 'workflow',
            ADAPTIVE_TEST_CWD: repo.cwd,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    first = start(true);
    await marker(first, 'ROUTED');
    await kill(first);
    const before = await database.query(
      'SELECT task FROM adaptive_recovery_submissions WHERE queue = $1',
      [queueName],
    );
    expect(before.rows).toHaveLength(1);
    second = start(false);
    const line = await marker(second, 'RESULT ');
    const result = JSON.parse(line.slice(7)) as {
      state: string;
      result: StandaloneReviewResult;
    };
    expect(result.state).toBe('completed');
    expect(result.result.status).toBe('completed');
    if (result.result.status !== 'completed') throw new Error('Missing report');
    expect(result.result.report.results.map((lane) => lane.status)).toEqual([
      'clear',
      'clear',
    ]);
    const after = await database.query(
      'SELECT body, task, requests FROM adaptive_recovery_submissions WHERE queue = $1',
      [queueName],
    );
    expect(after.rows).toHaveLength(3);
    expect(
      after.rows.every(
        (row) => row.body.correlationId === correlationId && row.requests === 1,
      ),
    ).toBe(true);
    expect(result.result.report.taskIds).toContain(before.rows[0].task.id);
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
    repo.close();
  }
}, 60_000);

it('binds complete intent before worker startup and reuses the completed execution', async () => {
  const repo = reviewFixture();
  const databaseUrl = process.env.ADAPTIVE_TEST_DATABASE_URL as string;
  const tasks = new IdempotentReviewTasks();
  const input: StandaloneReviewInput = {
    repo: 'another/project',
    pr: 7,
    correlationId: randomUUID(),
    teamId: 'team',
    diaryId: 'diary',
    runtimeSha: repo.base,
    mode: 'shadow',
    profiles: { classifier: 'classifier', focused: 'reviewer' },
    taskBudgets: parseReviewTaskBudgets(),
    protectedPaths: [],
    appLogin: 'reviewer[bot]',
    publication: 'report-only',
    runUrl: 'https://example.com/review',
    inlineFindings: false,
  };
  const services: StandaloneReviewServices = {
    cwd: repo.cwd,
    github: {
      pullRequest: async () => ({
        number: 7,
        title: 'Change value',
        body: '',
        changed_files: 1,
        user: { login: 'contributor' },
        base: { sha: repo.base },
        head: { sha: repo.head, repo: { full_name: input.repo } },
      }),
      files: async () => [{ filename: 'example.ts' }],
      revisions: async () => ({ base: repo.base, head: repo.head }),
      reviewThreads: async () => [],
    },
    connect: async () => ({
      profiles: async () =>
        ['classifier', 'reviewer'].map((id) => ({ id, name: id, revision: 1 })),
      tasks,
    }),
    ensureGit: async () => {},
    publish: async () => {},
  };
  let starts = 0;
  const args = {
    databaseUrl,
    input,
    services: {
      ...services,
      ensureCapacity: () => {
        starts += 1;
        return Promise.resolve();
      },
    },
  };
  try {
    const result = await runStandaloneReview(args);
    expect(result.status).toBe('completed');
    expect(starts).toBe(2);
    expect(tasks.created).toHaveLength(3);
    expect(await runStandaloneReview(args)).toEqual(result);
    expect(starts).toBe(2);
    await expect(
      runStandaloneReview({ ...args, input: { ...input, pr: 8 } }),
    ).rejects.toThrow('incompatible pinned inputs');
    expect(starts).toBe(2);
    expect(tasks.created).toHaveLength(3);
  } finally {
    const queueName = workflowExecutionQueue(input.correlationId);
    for (const suffix of ['', '-input']) {
      const app = createAdaptiveWorkflowApp({
        databaseUrl,
        queueName: queueName + suffix,
        run: async () => null,
      });
      await app.dropQueue();
      await app.close();
    }
    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query(
      'DELETE FROM public.adaptive_review_retention WHERE queue_name = $1',
      [queueName],
    );
    await db.end();
    repo.close();
  }
}, 30_000);
