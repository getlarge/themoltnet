import { randomUUID } from 'node:crypto';

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
  moltnet-parallel-brief-runner --team <uuid> --diary <uuid> --database-url <url> \\
    --brief "first brief" --brief "second brief" [--summary "how to combine"] \\
    [--queue <name>] [--agent-dir <path>] [--poll-interval <sec>] [--concurrency <n>]

Repeat --brief for each parallel task. Requires an Absurd-initialized Postgres at --database-url.`;

interface CliConfig {
  databaseUrl: string;
  queueName?: string;
  agentDir?: string;
  input: ParallelBriefsInput;
}

function parseArgs(argv: string[]): CliConfig {
  const briefs: string[] = [];
  let teamId = '';
  let diaryId = '';
  let databaseUrl = '';
  let summaryBrief: string | undefined;
  let queueName: string | undefined;
  let agentDir: string | undefined;
  let pollIntervalSec: number | undefined;
  let concurrency: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--help':
      case '-h':
        // eslint-disable-next-line no-console
        console.log(HELP);
        process.exit(0);
        break;
      case '--team':
        teamId = next();
        break;
      case '--diary':
        diaryId = next();
        break;
      case '--database-url':
        databaseUrl = next();
        break;
      case '--brief':
        briefs.push(next());
        break;
      case '--summary':
        summaryBrief = next();
        break;
      case '--queue':
        queueName = next();
        break;
      case '--agent-dir':
        agentDir = next();
        break;
      case '--poll-interval':
        pollIntervalSec = Number(next());
        break;
      case '--concurrency':
        concurrency = Number(next());
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!teamId) throw new Error('--team is required');
  if (!diaryId) throw new Error('--diary is required');
  if (!databaseUrl) throw new Error('--database-url is required');
  if (briefs.length === 0) throw new Error('at least one --brief is required');

  return {
    databaseUrl,
    queueName,
    agentDir,
    input: {
      teamId,
      diaryId,
      briefs,
      summaryBrief,
      correlationId: randomUUID(),
      pollIntervalSec,
      concurrency,
    },
  };
}

async function main(): Promise<number> {
  const cfg = parseArgs(process.argv.slice(2));
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
