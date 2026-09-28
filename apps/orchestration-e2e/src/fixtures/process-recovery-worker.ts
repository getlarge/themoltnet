import { randomUUID } from 'node:crypto';

import {
  createOrchestrationAbsurdApp,
  parallelTasks,
  type SdkTask,
  type SdkTaskAttempt,
  type TaskClient,
  waitForRecoverableTask,
  waitForValidatedTask,
} from '@themoltnet/tasks-orchestrator';
import { Client } from 'pg';

function requiredEnv(name: string): string {
  // eslint-disable-next-line no-restricted-syntax -- child-process fixture input
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

async function runRecoverableStage(
  runKey: string,
  ctx: Parameters<Parameters<typeof createOrchestrationAbsurdApp>[0]['run']>[1],
) {
  const body: Parameters<TaskClient['createTask']>[0] = {
    taskType: 'freeform',
    teamId: 'team',
    diaryId: 'diary',
    correlationId: runKey,
    input: { brief: 'same frozen stage request' },
    maxAttempts: 1,
  };
  const task = (id: string, failed: boolean): SdkTask =>
    ({
      id,
      taskType: body.taskType,
      title: null,
      tags: [],
      teamId: body.teamId,
      diaryId: body.diaryId,
      projectId: null,
      correlationId: runKey,
      input: body.input,
      outputKind: 'artifact',
      inputSchemaCid: 'cid:schema',
      inputCid: 'cid:frozen-stage',
      references: [],
      claimCondition: null,
      allowedProfiles: [],
      requiredExecutorTrustLevel: 'selfDeclared',
      maxAttempts: 1,
      status: failed ? 'failed' : 'completed',
      acceptedAttemptN: failed ? null : 1,
      proposedByAgentId: 'agent',
      proposedByHumanId: null,
      queuedAt: new Date(0).toISOString(),
      completedAt: new Date(0).toISOString(),
      expiresAt: null,
      cancelledByAgentId: null,
      cancelledByHumanId: null,
      cancelReason: null,
      dispatchTimeoutSec: null,
      runningTimeoutSec: null,
    }) as SdkTask;
  const initialTask = task(`initial:${runKey}`, true);
  const taskClient: TaskClient = {
    getTask: (id) => Promise.resolve(task(id, id === initialTask.id)),
    listAttempts: (id) =>
      Promise.resolve([
        {
          taskId: id,
          attemptN: 1,
          status: id === initialTask.id ? 'failed' : 'completed',
          output: id === initialTask.id ? null : { done: true },
          usage: { inputTokens: 3, outputTokens: 2 },
        } as SdkTaskAttempt,
      ]),
    createTask: async (_request, options) => {
      const idempotencyKey = options?.idempotencyKey;
      if (!idempotencyKey)
        throw new Error('missing task-create idempotency key');
      if (scenario === 'recoverable-decision' && mode === 'initial') {
        process.stdout.write('DECISION_CHECKPOINTED\n');
        await new Promise<never>(() => {});
      }
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      let replacementTaskId: string;
      try {
        const persisted = await client.query<{ task_id: string }>(
          `INSERT INTO orchestration_recovery_replacements
             (run_key, idempotency_key, task_id, create_requests)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (run_key, idempotency_key)
           DO UPDATE SET create_requests = orchestration_recovery_replacements.create_requests + 1
           RETURNING task_id`,
          [runKey, idempotencyKey, randomUUID()],
        );
        replacementTaskId = persisted.rows[0].task_id;
      } finally {
        await client.end();
      }
      if (scenario === 'recoverable-create' && mode === 'initial') {
        process.stdout.write(`REPLACEMENT_CREATED ${replacementTaskId}\n`);
        await new Promise<never>(() => {});
      }
      return task(replacementTaskId, false);
    },
  };
  await ctx.step('accepted-upstream', async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(
        'INSERT INTO orchestration_recovery_effects (run_key, calls) VALUES ($1, 1)',
        [runKey],
      );
    } finally {
      await client.end();
    }
    return { accepted: true };
  });
  return waitForRecoverableTask(initialTask, {
    tasks: taskClient,
    ctx,
    pollIntervalSec: 0,
    parse: (output) => output as { done: boolean },
    frozenRequest: body,
    maxReplacements: 1,
    gateTimeoutMs: 5_000,
    checkpointPrefix: 'stage.1',
    recoveryGate: {
      identity: { name: 'test-rule', version: '1' },
      decide: async ({ idempotencyKey }) => {
        if (!idempotencyKey)
          throw new Error('missing decision idempotency key');
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
          await client.query(
            `INSERT INTO orchestration_recovery_decisions (run_key, idempotency_key, calls)
             VALUES ($1, $2, 1)
             ON CONFLICT (run_key, idempotency_key)
             DO UPDATE SET calls = orchestration_recovery_decisions.calls + 1`,
            [runKey, idempotencyKey],
          );
        } finally {
          await client.end();
        }
        return {
          verdict: 'approve',
          reasonCode: 'retryable',
          engine: { name: 'test-rule', version: '1' },
        };
      },
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
    if (
      scenario === 'recoverable-decision' ||
      scenario === 'recoverable-create'
    ) {
      return runRecoverableStage(input.runKey, ctx);
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
