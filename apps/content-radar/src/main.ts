import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';
import pino from 'pino';

import {
  CONTENT_RADAR_QUEUE,
  CONTENT_RADAR_TASK,
  createContentRadarAbsurdApp,
} from './absurd.js';
import { currentProcessEnv, HELP, parseCliConfig } from './config.js';
import { resolveProfileRouting } from './profile-routing.js';
import {
  type ArtifactStore,
  type ContentRadarInput,
  WATCHLIST_CONTENT_TYPE,
} from './types.js';
import { canonicalWatchlistBytes, watchlistSha256 } from './watchlist.js';

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
  if (parsed.kind === 'validate') {
    // Read-only: executes before connect(), with no artifact or task effects.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          watchlist: parsed.config.watchlist,
          sha256: watchlistSha256(parsed.config.watchlist),
          repos: parsed.config.watchlist.repos.length,
          segments: parsed.config.watchlist.segments.length,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const cfg = parsed.config;
  const logger = pino({ name: 'content-radar' }, pino.destination(2));
  const agent = await connect(
    cfg.agentDir ? { configDir: cfg.agentDir } : undefined,
  );
  const teamId = cfg.teamId;

  const profileRouting = cfg.profileRoutingRefs
    ? await resolveProfileRouting(agent, teamId, cfg.profileRoutingRefs)
    : undefined;

  const artifacts: ArtifactStore = {
    stage: (bytes, metadata, context) =>
      agent.tasks.artifacts.stage(bytes, metadata, context),
  };

  const watchlistBytes = canonicalWatchlistBytes(cfg.watchlist);
  const stagedWatchlist = await artifacts.stage(
    watchlistBytes,
    { contentType: WATCHLIST_CONTENT_TYPE },
    { teamId },
  );

  const input: ContentRadarInput = {
    teamId,
    diaryId: cfg.diaryId,
    correlationId: cfg.correlationId,
    maxDrafts: cfg.maxDrafts,
    watchlistManifest: {
      watchlist: cfg.watchlist,
      sha256: watchlistSha256(cfg.watchlist),
      artifact: {
        cid: stagedWatchlist.cid,
        title: 'content-radar-watchlist.v1.json',
        contentType: stagedWatchlist.contentType ?? WATCHLIST_CONTENT_TYPE,
        sizeBytes: stagedWatchlist.sizeBytes,
      },
    },
    ...(cfg.pollIntervalSec ? { pollIntervalSec: cfg.pollIntervalSec } : {}),
    ...(cfg.concurrency ? { concurrency: cfg.concurrency } : {}),
    ...(profileRouting ? { profileRouting } : {}),
  };

  const tasks = createSdkTaskClient(agent);
  const queueName = cfg.queueName ?? CONTENT_RADAR_QUEUE;
  const app = createContentRadarAbsurdApp({
    databaseUrl: cfg.databaseUrl,
    queueName,
    deps: { tasks, artifacts, logger },
  });

  let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
  try {
    await app.createQueue(queueName);
    logger.info(
      {
        correlationId: input.correlationId,
        watchlistSha256: input.watchlistManifest.sha256,
      },
      'content_radar.correlation',
    );
    const spawned = await app.spawn(CONTENT_RADAR_TASK, input, {
      queue: queueName,
      idempotencyKey: `content-radar:${input.correlationId}`,
    });
    logger.info(
      { taskID: spawned.taskID, correlationId: input.correlationId },
      'content_radar.spawned',
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
    console.error(
      '[fatal]',
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.exit(1);
  });
