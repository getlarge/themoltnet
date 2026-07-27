import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { connect } from '@themoltnet/sdk';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';
import pino from 'pino';

import {
  createMultiLensReviewAbsurdApp,
  MULTI_LENS_REVIEW_TASK,
} from './absurd.js';
import type { MultiLensReviewInput } from './types.js';

const HELP = `moltnet-multi-lens-review — fan out N specialist code reviews (security, correctness, performance, test-coverage) in parallel and join them into one server-gated verdict.

Usage:
  MULTI_LENS_REVIEW_DATABASE_URL=<url> moltnet-multi-lens-review --team <uuid> --diary <uuid> \\
    --target "libs/foo — the change in bar.ts" \\
    [--diff "<diff text>" | --diff-file <path>] \\
    [--lens security --lens correctness ...] [--synthesis "how to consolidate"] \\
    [--queue <name>] [--agent-dir <path>] [--poll-interval <sec>] [--concurrency <n>]

Repeat --lens to override the default lenses. The Absurd-initialized Postgres URL
is read from the MULTI_LENS_REVIEW_DATABASE_URL environment variable — not argv —
so the credential is not exposed via shell history or process listings.`;

interface CliConfig {
  databaseUrl: string;
  queueName?: string;
  agentDir?: string;
  input: MultiLensReviewInput;
}

function positiveInt(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer (got "${raw}")`);
  }
  return value;
}

function parseCliConfig(argv: string[]): CliConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' },
      team: { type: 'string' },
      diary: { type: 'string' },
      target: { type: 'string' },
      diff: { type: 'string' },
      'diff-file': { type: 'string' },
      lens: { type: 'string', multiple: true },
      synthesis: { type: 'string' },
      queue: { type: 'string' },
      'agent-dir': { type: 'string' },
      'poll-interval': { type: 'string' },
      concurrency: { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    // eslint-disable-next-line no-console
    console.log(HELP);
    process.exit(0);
  }

  // Read the credential-bearing Postgres URL from a protected env var rather
  // than argv, so it is not exposed through shell history or process listings.
  // eslint-disable-next-line no-restricted-syntax -- CLI reads DB URL secret from env by design
  const databaseUrl = process.env.MULTI_LENS_REVIEW_DATABASE_URL ?? '';

  if (!values.team) throw new Error('--team is required');
  if (!values.diary) throw new Error('--diary is required');
  if (!values.target) throw new Error('--target is required');
  if (values.diff && values['diff-file']) {
    throw new Error('pass at most one of --diff or --diff-file');
  }
  if (!databaseUrl) {
    throw new Error(
      'MULTI_LENS_REVIEW_DATABASE_URL environment variable is required',
    );
  }

  const diff = values['diff-file']
    ? readFileSync(values['diff-file'], 'utf8')
    : values.diff;

  return {
    databaseUrl,
    queueName: values.queue,
    agentDir: values['agent-dir'],
    input: {
      teamId: values.team,
      diaryId: values.diary,
      target: values.target,
      diff,
      lenses: values.lens,
      synthesisBrief: values.synthesis,
      correlationId: randomUUID(),
      pollIntervalSec:
        values['poll-interval'] === undefined
          ? undefined
          : positiveInt(values['poll-interval'], '--poll-interval'),
      concurrency:
        values.concurrency === undefined
          ? undefined
          : positiveInt(values.concurrency, '--concurrency'),
    },
  };
}

async function main(): Promise<number> {
  const cfg = parseCliConfig(process.argv.slice(2));
  const logger = pino({ name: 'multi-lens-review' });
  const agent = await connect(
    cfg.agentDir ? { configDir: cfg.agentDir } : undefined,
  );
  const queueName = cfg.queueName ?? 'multi-lens-review';
  const app = createMultiLensReviewAbsurdApp({
    databaseUrl: cfg.databaseUrl,
    queueName,
    deps: { tasks: createSdkTaskClient(agent), logger },
  });
  let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
  try {
    await app.createQueue(queueName);
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
