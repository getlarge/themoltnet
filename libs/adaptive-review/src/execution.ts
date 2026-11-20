import { createHash } from 'node:crypto';

import {
  createOrchestrationAbsurdApp,
  type Logger,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';
import type { Client } from 'pg';

import { reviewContext } from './context.js';
import {
  cleanupReviewExecutions,
  type ReviewRetentionPolicy,
  withReviewExecution,
} from './retention.js';

export const ADAPTIVE_STAGE_TASK = 'adaptive_review_stage_v1';
export const ADAPTIVE_WORKFLOW_TASK = 'adaptive_review_v1';
type ExecutionStage = 'prepare' | 'route' | 'review' | 'publish';

function taskName(stage?: ExecutionStage): string {
  return stage ? `${ADAPTIVE_STAGE_TASK}:${stage}` : ADAPTIVE_STAGE_TASK;
}

export function workflowExecutionQueue(executionId: string): string {
  return executionQueue(
    `workflow-${ADAPTIVE_WORKFLOW_TASK.split('_').at(-1)}:${executionId}`,
  );
}

/** Compare JSON inputs independently of object insertion order. */
export function canonicalInput(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

export function executionQueue(executionId: string): string {
  const digest = createHash('sha256')
    .update(executionId)
    .digest('hex')
    .slice(0, 24);
  return `adaptive-${digest}`;
}

type StageInput<T> = { operation: 'bind' | 'run'; input: T };

/** Existing Node stage host, backed by the shared Absurd adapter. */
export function createAdaptiveStageApp<T, R>(args: {
  databaseUrl: string;
  queueName: string;
  stage?: ExecutionStage;
  run: (input: T, ctx: WorkflowContext) => Promise<R>;
}) {
  return createReviewApp({ ...args, taskName: taskName(args.stage) });
}

export function createAdaptiveWorkflowApp<T, R>(args: {
  databaseUrl: string;
  queueName: string;
  run: (input: T, ctx: WorkflowContext) => Promise<R>;
}) {
  return createReviewApp({ ...args, taskName: ADAPTIVE_WORKFLOW_TASK });
}

function createReviewApp<T, R>(args: {
  databaseUrl: string;
  queueName: string;
  taskName: string;
  logger?: Logger;
  run: (input: T, ctx: WorkflowContext) => Promise<R>;
}) {
  return createOrchestrationAbsurdApp<StageInput<T>>({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName,
    taskName: args.taskName,
    logger: args.logger,
    run: async ({ operation, input }, ctx) =>
      operation === 'bind'
        ? { input }
        : args.run(input, reviewContext(ctx, 'adaptive')),
  });
}

/**
 * A queue belongs to one review execution: a transient host must never claim
 * another repository's work with this process's checkout or credentials.
 * The bind task is an immutable input record, checked BEFORE claiming run work.
 */
interface ExecuteStageArgs<T, R> {
  databaseUrl: string;
  executionId: string;
  stage: ExecutionStage;
  input: T;
  retryFailed?: boolean;
  retention?: ReviewRetentionPolicy;
  signal?: AbortSignal;
  /** Host capacity starts only after immutable intent has been validated. */
  onBound?: () => Promise<void>;
  run: (input: T, ctx: WorkflowContext) => Promise<R>;
}

export async function executeAdaptiveStage<T, R>(
  args: ExecuteStageArgs<T, R>,
): Promise<R> {
  if (!args.databaseUrl) throw new Error('ADAPTIVE_DATABASE_URL is required');
  if (!args.executionId) throw new Error('review execution ID is required');
  return executeReview(args, {
    queueName: executionQueue(args.executionId),
    taskName: taskName(args.stage),
    key: args.stage,
    exclusive: args.stage === 'publish',
    cleanup: args.stage === 'prepare',
  });
}

interface ExecutionOptions {
  queueName: string;
  taskName: string;
  key: string;
  exclusive: boolean;
  cleanup: boolean;
}

function executeReview<T, R>(
  args: Omit<ExecuteStageArgs<T, R>, 'stage'>,
  options: ExecutionOptions,
): Promise<R> {
  return withReviewExecution(
    args.databaseUrl,
    options.queueName,
    options.exclusive,
    async (connection) => {
      if (options.cleanup)
        await cleanupReviewExecutions({
          databaseUrl: args.databaseUrl,
          policy: args.retention,
          apply: true,
        });
      return executeBoundStage(args, connection, options);
    },
    options.cleanup ? args.retention : undefined,
  );
}

async function executeBoundStage<T, R>(
  args: Omit<ExecuteStageArgs<T, R>, 'stage'>,
  connection: Client,
  options: ExecutionOptions,
): Promise<R> {
  const { queueName } = options;
  // Binding has its own queue, so validation cannot accidentally execute work.
  const bindingFactory = createAdaptiveStageApp<T, never>({
    databaseUrl: args.databaseUrl,
    queueName: `${queueName}-input`,
    run: () => {
      throw new Error('input queue cannot execute review work');
    },
  });
  const binding = bindingFactory.bindToConnection(connection);
  await bindingFactory.close();
  let bindingWorker:
    Awaited<ReturnType<typeof binding.startWorker>> | undefined;
  try {
    await binding.createQueue();
    const pinned = await binding.spawn(
      ADAPTIVE_STAGE_TASK,
      { operation: 'bind', input: args.input },
      { idempotencyKey: options.key },
    );
    bindingWorker = await binding.startWorker({ concurrency: 1 });
    const bound = await interruptible(
      () => binding.awaitTaskResult(pinned.taskID),
      args.signal,
    );
    if (bound.state !== 'completed')
      throw new Error(`review input binding ${bound.state}`);
    if (
      canonicalInput((bound.result as { input: T }).input) !==
      canonicalInput(args.input)
    ) {
      throw new Error(
        'incompatible pinned inputs on resume; use the original inputs or start a new review',
      );
    }
  } finally {
    await bindingWorker?.close();
    await binding.close();
  }
  let logged = false;
  const appFactory = createReviewApp({
    databaseUrl: args.databaseUrl,
    queueName,
    taskName: options.taskName,
    logger: {
      warn: () => {},
      error: () => {},
      info(fields: Record<string, unknown>, message: string) {
        if (!logged) {
          logged = true;
          process.stderr.write(
            JSON.stringify({
              ...fields,
              correlationId: args.executionId,
              event: message,
            }) + '\n',
          );
        }
      },
    },
    run: args.run,
  });
  const app = appFactory.bindToConnection(connection);
  await appFactory.close();
  let worker: Awaited<ReturnType<typeof app.startWorker>> | undefined;
  try {
    await app.createQueue();
    const spawned = await app.spawn(
      options.taskName,
      { operation: 'run', input: args.input },
      { idempotencyKey: options.key },
    );
    const snapshot = await app.fetchTaskResult(spawned.taskID);
    if (snapshot?.state === 'failed' && args.retryFailed) {
      await app.retryTask(spawned.taskID);
    }
    if (
      snapshot?.state !== 'completed' &&
      (snapshot?.state !== 'failed' || args.retryFailed)
    )
      await args.onBound?.();
    worker = await app.startWorker({ concurrency: 1 });
    const result = await interruptible(
      () => app.awaitTaskResult(spawned.taskID),
      args.signal,
    );
    if (result.state !== 'completed')
      throw new Error(
        `adaptive review ${args.executionId} execution ${spawned.taskID} ${result.state}`,
        { cause: 'failure' in result ? result.failure : undefined },
      );
    return result.result as R;
  } finally {
    await worker?.close();
    await app.close();
  }
}

async function interruptible<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation();
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () =>
      reject(new Error('Review host stopped; workflow state is retained'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Workflow task name is the single version source; legacy queue identities stay unchanged. */
export function executeAdaptiveWorkflow<T, R>(
  args: Omit<ExecuteStageArgs<T, R>, 'stage'>,
): Promise<R> {
  if (!args.databaseUrl || !args.executionId)
    throw new Error('Review database and execution ID required');
  return executeReview(args, {
    queueName: workflowExecutionQueue(args.executionId),
    taskName: ADAPTIVE_WORKFLOW_TASK,
    key: 'workflow',
    exclusive: true,
    cleanup: true,
  });
}
