import { randomUUID } from 'node:crypto';

import {
  createOrchestrationAbsurdApp,
  parallelTasks,
  type SdkTask,
  type SdkTaskAttempt,
  type TaskClient,
  waitForValidatedTask,
} from '@themoltnet/tasks-orchestrator';
import { Client } from 'pg';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const databaseUrl = requiredEnv('ORCHESTRATION_ABSURD_URL');
const queueName = requiredEnv('ORCHESTRATION_RECOVERY_QUEUE');
const taskId = requiredEnv('ORCHESTRATION_RECOVERY_TASK_ID');
const mode = requiredEnv('ORCHESTRATION_RECOVERY_MODE');
const scenario = requiredEnv('ORCHESTRATION_RECOVERY_SCENARIO');

function completedTask(id: string): SdkTask {
  return {
    id,
    status: 'completed',
    acceptedAttemptN: 1,
  } as SdkTask;
}

function completedAttempt(
  taskIdValue: string,
  output: Record<string, unknown>,
  usage: NonNullable<SdkTaskAttempt['usage']>,
): SdkTaskAttempt {
  return {
    taskId: taskIdValue,
    attemptN: 1,
    status: 'completed',
    output,
    outputCid: `cid:${taskIdValue}`,
    usage,
  } as SdkTaskAttempt;
}

async function runValidatedRepair(
  runKey: string,
  ctx: Parameters<Parameters<typeof createOrchestrationAbsurdApp>[0]['run']>[1],
) {
  const initialTask = completedTask(`initial:${runKey}`);
  const taskClient: TaskClient = {
    createTask: () => Promise.reject(new Error('not used')),
    getTask: (id) => Promise.resolve(completedTask(id)),
    listAttempts: (id) =>
      Promise.resolve([
        id === initialTask.id
          ? completedAttempt(
              id,
              { invalid: true },
              {
                inputTokens: 4,
                outputTokens: 1,
                cacheReadTokens: 2,
                toolCalls: 1,
                model: 'invalid-model',
                provider: 'invalid-provider',
              },
            )
          : completedAttempt(
              id,
              { phase: 'repaired' },
              {
                inputTokens: 6,
                outputTokens: 2,
                cacheWriteTokens: 3,
                model: 'repair-model',
                provider: 'repair-provider',
              },
            ),
      ]),
  };

  return waitForValidatedTask(initialTask, {
    tasks: taskClient,
    ctx,
    pollIntervalSec: 0,
    maxRepairs: 1,
    parse: (output) => {
      const phase = (output as { phase?: unknown }).phase;
      if (phase !== 'repaired') throw new Error('phase must be repaired');
      return { phase };
    },
    createRepairTask: async ({ idempotencyKey }) => {
      if (!idempotencyKey) {
        throw new Error('durable repair creation requires an idempotency key');
      }
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      let repairTaskId: string;
      try {
        const persisted = await client.query<{ task_id: string }>(
          `INSERT INTO orchestration_recovery_repairs
             (run_key, idempotency_key, task_id, create_requests)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (run_key, idempotency_key)
           DO UPDATE SET create_requests =
             orchestration_recovery_repairs.create_requests + 1
           RETURNING task_id`,
          [runKey, idempotencyKey, randomUUID()],
        );
        repairTaskId = persisted.rows[0].task_id;
      } finally {
        await client.end();
      }

      if (mode === 'initial') {
        process.stdout.write(
          `REPAIR_CREATED ${repairTaskId} ${idempotencyKey}\n`,
        );
        await new Promise<never>(() => {});
      }
      return completedTask(repairTaskId);
    },
  });
}

const app = createOrchestrationAbsurdApp<{ runKey: string }>({
  databaseUrl,
  queueName,
  taskName: 'process_recovery',
  defaultMaxAttempts: 3,
  run: async (input, ctx) => {
    if (ctx.executionId !== taskId) {
      throw new Error(
        `workflow executionId ${String(ctx.executionId)} did not match ${taskId}`,
      );
    }
    if (scenario === 'validated-repair') {
      return runValidatedRepair(input.runKey, ctx);
    }
    await ctx.step('external-effect', async () => {
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(
          `INSERT INTO orchestration_recovery_effects (run_key, calls)
           VALUES ($1, 1)`,
          [input.runKey],
        );
      } finally {
        await client.end();
      }
      return { persisted: true };
    });

    const children = await parallelTasks({
      ctx,
      items: ['first', 'second'],
      // Deliberately repeated: Absurd must disambiguate the actual checkpoints.
      createStepName: () => 'child.create',
      create: async (branch, _index, metadata) => {
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
          await client.query(
            `INSERT INTO orchestration_recovery_children
               (run_key, branch, calls, execution_id, checkpoint_name, idempotency_key)
             VALUES ($1, $2, 1, $3, $4, $5)`,
            [
              input.runKey,
              branch,
              ctx.executionId,
              metadata.stepName,
              metadata.idempotencyKey,
            ],
          );
        } finally {
          await client.end();
        }
        return { branch, ...metadata };
      },
      awaitResult: (created) => Promise.resolve(created),
    });

    if (mode === 'initial') {
      process.stdout.write('CHECKPOINTED\n');
      await new Promise<never>(() => {});
    }

    return {
      recovered: true,
      runKey: input.runKey,
      executionId: ctx.executionId,
      children: children.results,
    };
  },
});

let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
try {
  worker = await app.startWorker({
    concurrency: 1,
    claimTimeout: 1,
    pollInterval: 0.05,
    fatalOnLeaseTimeout: false,
  });
  if (mode === 'recovery') {
    const result = await app.awaitTaskResult(taskId, { timeout: 30 });
    process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
  } else {
    await new Promise<never>(() => {});
  }
} finally {
  await worker?.close();
  await app.close();
}
