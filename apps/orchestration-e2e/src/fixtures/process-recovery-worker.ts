import {
  createOrchestrationAbsurdApp,
  parallelTasks,
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
