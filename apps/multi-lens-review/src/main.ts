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
import {
  inspectReviewDiff,
  printablePreflight,
  stageReviewManifest,
} from './review-input.js';
import { hydrateMultiLensReviewOutput } from './review-output.js';
import { cancelCorrelatedTasks } from './run-cleanup.js';
import { MAX_SINGLETON_TOPIC_BYTES } from './topic-plan.js';
import type {
  MultiLensReviewDurableOutput,
  ReviewArtifactStore,
} from './types.js';

async function collectStream(
  stream: AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const value of stream) {
    size += value.byteLength;
    if (size > MAX_SINGLETON_TOPIC_BYTES) {
      throw new Error(
        `downloaded review file exceeds ${MAX_SINGLETON_TOPIC_BYTES} bytes`,
      );
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

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
  const inspected = inspectReviewDiff(
    parsed.config.diff,
    parsed.config.githubFiles,
  );
  if (parsed.kind === 'preflight') {
    // This branch deliberately executes before connect(): it is a read-only,
    // local classifier with no artifact or task side effects.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(printablePreflight(inspected), null, 2));
    return 0;
  }

  const cfg = parsed.config;
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
  const reviewManifest = await stageReviewManifest(agent, teamId, inspected);
  const input = { ...cfg.input, reviewManifest };
  const patches = new Map(
    inspected.files.map((file) => [
      file.path,
      new Uint8Array(Buffer.from(file.patch, 'utf8')),
    ]),
  );
  const artifacts: ReviewArtifactStore = {
    stage: (bytes, metadata, context) =>
      agent.tasks.artifacts.stage(bytes, metadata, context),
    download: async (taskId, cid, context) => {
      const downloaded = await agent.tasks.artifacts.download(
        { taskId, cid },
        context,
      );
      return collectStream(downloaded.stream);
    },
  };
  const tasks = createSdkTaskClient(agent);
  const queueName = cfg.queueName ?? 'multi-lens-review';
  const app = createMultiLensReviewAbsurdApp({
    databaseUrl: cfg.databaseUrl,
    queueName,
    deps: {
      tasks,
      artifacts,
      patches: {
        read: (path) => {
          const bytes = patches.get(path);
          if (!bytes) throw new Error(`review patch source has no ${path}`);
          return Promise.resolve(bytes);
        },
      },
      logger,
    },
  });
  let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
  try {
    await app.createQueue(queueName);
    logger.info(
      { correlationId: input.correlationId },
      'multi_lens_review.correlation',
    );
    const spawned = await app.spawn(MULTI_LENS_REVIEW_TASK, input, {
      queue: queueName,
      idempotencyKey: `multi-lens-review:${input.correlationId}`,
    });
    logger.info(
      { taskID: spawned.taskID, correlationId: input.correlationId },
      'multi_lens_review.spawned',
    );
    worker = await app.startWorker({ concurrency: 1 });
    const result = await app.awaitTaskResult(spawned.taskID);
    if (result.state !== 'completed') {
      const cancelled = await cancelCorrelatedTasks(
        agent,
        teamId,
        input.correlationId,
      ).catch(() => 0);
      logger.warn(
        { correlationId: input.correlationId, cancelled },
        'multi_lens_review.run.cancelled',
      );
    }
    const printableResult =
      result.state === 'completed'
        ? {
            ...result,
            result: await hydrateMultiLensReviewOutput(
              result.result as unknown as MultiLensReviewDurableOutput,
              tasks,
            ),
          }
        : result;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(printableResult, null, 2));
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
    console.error(
      '[fatal]',
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.exit(1);
  });
