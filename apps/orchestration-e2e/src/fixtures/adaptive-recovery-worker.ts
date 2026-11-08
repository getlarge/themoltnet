import { randomUUID } from 'node:crypto';

import {
  createAdaptiveStageApp,
  runAdaptiveReview,
  type RunOptions,
} from '@moltnet/adaptive-review';
import type {
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
} from '@themoltnet/tasks-orchestrator';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { Client } from 'pg';

const databaseUrl = process.env.ORCHESTRATION_ABSURD_URL as string;
const queueName = process.env.ADAPTIVE_TEST_QUEUE as string;
const taskId = process.env.ADAPTIVE_TEST_TASK as string;
const scenario = process.env.ADAPTIVE_TEST_SCENARIO as string;
const initial = process.env.ADAPTIVE_TEST_INITIAL === 'true';
const database = new Client({ connectionString: databaseUrl });
await database.connect();
const stop = async (marker: string): Promise<never> => {
  process.stdout.write(`${marker}\n`);
  return new Promise<never>(() => {});
};

const tasks: TaskClient = {
  async createTask(body, options) {
    if (!options?.idempotencyKey)
      throw new Error('missing submission idempotency');
    const output =
      body.taskType === 'classify'
        ? {
            answers: {
              tests: { type: 'bool', probability: 1 },
              conventions: { type: 'bool', probability: 1 },
            },
          }
        : scenario === 'repair' && body.tags?.includes('lane:tests')
          ? { result: { summary: 'invalid', findings: 'invalid', unclear: [] } }
          : { result: { summary: 'checked', findings: [], unclear: [] } };
    const fake = new FakeTasks([output]);
    const task = await fake.createTask(body, options);
    const attempts = await fake.listAttempts(task.id);
    task.id = randomUUID();
    attempts[0].taskId = task.id;
    const result = await database.query<{ task: SdkTask; body: unknown }>(
      `INSERT INTO adaptive_recovery_submissions (queue, key, body, task, attempts, requests)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (queue, key) DO UPDATE SET requests = adaptive_recovery_submissions.requests + 1
       RETURNING task, body`,
      [
        queueName,
        options.idempotencyKey,
        JSON.stringify(body),
        JSON.stringify(task),
        JSON.stringify(attempts),
      ],
    );
    // Postgres jsonb canonicalizes keys; compare through its equality operator.
    const matching = await database.query<{ matches: boolean }>(
      'SELECT body = $3::jsonb AS matches FROM adaptive_recovery_submissions WHERE queue = $1 AND key = $2',
      [queueName, options.idempotencyKey, JSON.stringify(body)],
    );
    if (!matching.rows[0].matches)
      throw new Error('changed idempotent request');
    if (
      initial &&
      (scenario === 'create' ||
        (scenario === 'repair' && body.input.continueFrom))
    )
      await stop('CREATED');
    return result.rows[0].task;
  },
  async getTask(id) {
    const result = await database.query<{ task: SdkTask }>(
      "SELECT task FROM adaptive_recovery_submissions WHERE queue = $1 AND task->>'id' = $2",
      [queueName, id],
    );
    const task = result.rows[0].task;
    if (
      initial &&
      ((scenario === 'await' && task.taskType === 'classify') ||
        (scenario === 'parallel' && task.tags.includes('lane:conventions')))
    ) {
      return { ...task, status: 'running', acceptedAttemptN: null };
    }
    return task;
  },
  async listAttempts(id) {
    const result = await database.query<{ attempts: SdkTaskAttempt[] }>(
      "SELECT attempts FROM adaptive_recovery_submissions WHERE queue = $1 AND task->>'id' = $2",
      [queueName, id],
    );
    return result.rows[0].attempts;
  },
};
let partial = false;
const app = createAdaptiveStageApp<Omit<RunOptions, 'tasks' | 'ctx'>, unknown>({
  databaseUrl,
  queueName,
  run: (input, ctx) =>
    runAdaptiveReview({
      ...input,
      tasks,
      ctx: {
        ...ctx,
        async completeStep(handle, value) {
          if (!ctx.completeStep)
            throw new Error('Absurd must support decomposed checkpoints');
          const result = await ctx.completeStep(handle, value);
          if (
            initial &&
            scenario === 'parallel' &&
            handle.name.endsWith('lane.tests.result')
          )
            partial = true;
          return result;
        },
        async sleepFor(name, seconds) {
          try {
            await ctx.sleepFor(name, seconds);
          } catch (error) {
            if (initial && scenario === 'await')
              process.stdout.write('WAITING\n');
            if (initial && scenario === 'parallel' && partial)
              process.stdout.write('PARTIAL\n');
            throw error;
          }
        },
      },
    }),
});
let worker: Awaited<ReturnType<typeof app.startWorker>> | undefined;
try {
  worker = await app.startWorker({
    concurrency: 1,
    claimTimeout: 1,
    pollInterval: 0.05,
    fatalOnLeaseTimeout: false,
  });
  if (initial) await new Promise<never>(() => {});
  else
    process.stdout.write(
      `RESULT ${JSON.stringify(await app.awaitTaskResult(taskId, { timeout: 30 }))}\n`,
    );
} finally {
  await worker?.close();
  await app.close();
  await database.end();
}
