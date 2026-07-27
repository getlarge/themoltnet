import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

import { createSdkTaskClient } from '@moltnet/orchestration';
import { connect } from '@themoltnet/sdk';
import pino from 'pino';

import {
  createParallelBriefsAbsurdApp,
  PARALLEL_BRIEFS_TASK,
} from './absurd.js';
import type { ParallelBriefsInput } from './types.js';

const HELP = `moltnet-parallel-brief-runner — fan out N freeform briefs in parallel and join them with a server-gated summary continuation.

Usage:
  PARALLEL_BRIEFS_DATABASE_URL=<url> moltnet-parallel-brief-runner --team <uuid> --diary <uuid> \\
    --brief "first brief" --brief "second brief" [--summary "how to combine"] \\
    [--queue <name>] [--agent-dir <path>] [--poll-interval <sec>] [--concurrency <n>]

Repeat --brief for each parallel task. The Absurd-initialized Postgres URL is read
from the PARALLEL_BRIEFS_DATABASE_URL environment variable — not argv — so the
credential is not exposed via shell history or process listings.`;

interface CliConfig {
  databaseUrl: string;
  queueName?: string;
  agentDir?: string;
  input: ParallelBriefsInput;
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
      brief: { type: 'string', multiple: true },
      summary: { type: 'string' },
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

  const briefs = values.brief ?? [];

  // Read the credential-bearing Postgres URL from a protected env var rather
  // than argv, so it is not exposed through shell history or process listings.
  // This CLI entrypoint has no config module; env is the secret source here.
  // eslint-disable-next-line no-restricted-syntax -- CLI reads DB URL secret from env by design (PR #1674)
  const databaseUrl = process.env.PARALLEL_BRIEFS_DATABASE_URL ?? '';

  if (!values.team) throw new Error('--team is required');
  if (!values.diary) throw new Error('--diary is required');
  if (!databaseUrl) {
    throw new Error(
      'PARALLEL_BRIEFS_DATABASE_URL environment variable is required',
    );
  }
  if (briefs.length === 0) throw new Error('at least one --brief is required');

  return {
    databaseUrl,
    queueName: values.queue,
    agentDir: values['agent-dir'],
    input: {
      teamId: values.team,
      diaryId: values.diary,
      briefs,
      summaryBrief: values.summary,
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
  const logger = pino({ name: 'parallel-brief-runner' });
  const agent = await connect(
    cfg.agentDir ? { configDir: cfg.agentDir } : undefined,
  );
  const queueName = cfg.queueName ?? 'parallel-briefs';
  const app = createParallelBriefsAbsurdApp({
    databaseUrl: cfg.databaseUrl,
    queueName,
    deps: { tasks: createSdkTaskClient(agent), logger },
  });
  let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
  try {
    await app.createQueue(queueName);
    const spawned = await app.spawn(PARALLEL_BRIEFS_TASK, cfg.input, {
      queue: queueName,
      idempotencyKey: `parallel-briefs:${cfg.input.correlationId}`,
    });
    logger.info(
      { taskID: spawned.taskID, correlationId: cfg.input.correlationId },
      'parallel_briefs.spawned',
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
