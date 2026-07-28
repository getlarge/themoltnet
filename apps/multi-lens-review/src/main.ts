import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { connect } from '@themoltnet/sdk';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';
import pino from 'pino';

import {
  createMultiLensReviewAbsurdApp,
  MULTI_LENS_REVIEW_TASK,
} from './absurd.js';
import { currentProcessEnv, HELP, parseCliConfig } from './config.js';
import { resolveRuntimeProfileRouting } from './profile-routing.js';

async function main(): Promise<number> {
  const parsed = parseCliConfig(process.argv.slice(2), {
    env: currentProcessEnv(),
    readFile: (path) => readFileSync(path, 'utf8'),
    randomUUID,
  });
  if (parsed.kind === 'help') {
    // eslint-disable-next-line no-console
    console.log(HELP);
    return 0;
  }
  const cfg = parsed.config;
  // Keep stdout machine-readable: operational logs belong on stderr and the
  // terminal Absurd result is the sole stdout payload.
  const logger = pino({ name: 'multi-lens-review' }, pino.destination(2));
  const agent = await connect(
    cfg.agentDir ? { configDir: cfg.agentDir } : undefined,
  );
  const teamId = cfg.input.teamId;
  if (cfg.profileRoutingRefs) {
    cfg.input.profileRouting = await resolveRuntimeProfileRouting(
      agent,
      teamId,
      cfg.profileRoutingRefs,
    );
  }
  const TERMINAL_STATUSES = new Set([
    'completed',
    'failed',
    'cancelled',
    'aborted',
    'timed_out',
  ]);
  // Cancel every non-terminal task sharing the correlation id (used to clean up
  // a failed run's orphaned synthesis + in-flight reviews).
  const cancelRun = async (correlationId: string): Promise<number> => {
    const { items } = await agent.tasks.list({ correlationId }, { teamId });
    let cancelled = 0;
    for (const task of items) {
      if (TERMINAL_STATUSES.has(task.status)) continue;
      try {
        await agent.tasks.cancel(task.id, {
          reason: 'multi-lens-review run aborted',
        });
        cancelled += 1;
      } catch {
        // best-effort cleanup — ignore per-task cancel failures
      }
    }
    return cancelled;
  };
  const queueName = cfg.queueName ?? 'multi-lens-review';
  const app = createMultiLensReviewAbsurdApp({
    databaseUrl: cfg.databaseUrl,
    queueName,
    deps: { tasks: createSdkTaskClient(agent), logger },
  });
  let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
  try {
    await app.createQueue(queueName);
    // Emit the correlation id BEFORE spawning so an operator can capture it and
    // resume with `--correlation-id` if the spawn/await is interrupted.
    logger.info(
      { correlationId: cfg.input.correlationId },
      'multi_lens_review.correlation',
    );
    const spawned = await app.spawn(MULTI_LENS_REVIEW_TASK, cfg.input, {
      queue: queueName,
      idempotencyKey: `multi-lens-review:${cfg.input.correlationId}`,
    });
    logger.info(
      { taskID: spawned.taskID, correlationId: cfg.input.correlationId },
      'multi_lens_review.spawned',
    );
    worker = await app.startWorker({ concurrency: 1 });
    const result = await app.awaitTaskResult(spawned.taskID);
    if (result.state !== 'completed') {
      // Terminal failure (after all orchestration attempts): best-effort cancel
      // the run's orphaned tasks — the up-front server-gated synthesis (left
      // `waiting` forever) plus any in-flight reviews. Done here, at the terminal
      // outcome, NOT inside the workflow: a per-attempt cancel would cancel tasks
      // that an Absurd retry then replays via `ctx.step`.
      const cancelled = await cancelRun(cfg.input.correlationId).catch(() => 0);
      logger.warn(
        { correlationId: cfg.input.correlationId, cancelled },
        'multi_lens_review.run.cancelled',
      );
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    return result.state === 'completed' ? 0 : 1;
  } finally {
    await worker?.close();
    await app.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[fatal]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
