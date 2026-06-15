import { connect } from '@themoltnet/sdk';
import pino from 'pino';

import {
  createIssueLifecycleAbsurdApp,
  GITHUB_ISSUE_LIFECYCLE_TASK,
} from './absurd.js';
import { parseCliConfig } from './config.js';
import { GhCliGithubClient } from './github-cli.js';
import { FetchGithubClient } from './github-fetch.js';
import { createSdkTaskClient } from './sdk-task-client.js';
import type { GithubClient } from './types.js';
import { validateConfiguredProfiles } from './validate-profiles.js';

function createGithubClient(
  cfg: ReturnType<typeof parseCliConfig>,
): GithubClient {
  if (cfg.githubAuth === 'gh-cli') {
    return new GhCliGithubClient({
      cwd: cfg.repoRoot,
      env: cfg.githubEnv,
    });
  }
  return new FetchGithubClient({
    token: cfg.githubToken,
    tokenProvider: cfg.githubTokenProvider,
  });
}

async function main(): Promise<number> {
  const cfg = parseCliConfig();
  const logger = pino({ name: 'issue-lifecycle' });
  logger.info(
    {
      repo: cfg.input.repo,
      issueNumber: cfg.input.issueNumber,
      agentName: cfg.agentName,
      queueName: cfg.queueName,
      correlationId: cfg.input.correlationId,
      consoleUrl: cfg.input.consoleUrl,
      githubAuth: cfg.githubAuth,
      databaseUrlConfigured: Boolean(cfg.databaseUrl),
    },
    'issue_lifecycle.cli.start',
  );
  const agent = await connect({ configDir: cfg.agentDir });

  // Fail fast if the profiles config pins steps to runtime profiles this agent
  // can't resolve — otherwise those tasks would be created with an
  // unsatisfiable allowedProfiles allowlist and never get claimed.
  if (cfg.input.lifecycleConfig) {
    await validateConfiguredProfiles(
      agent.runtimeProfiles,
      cfg.input.lifecycleConfig,
    );
  }

  const app = createIssueLifecycleAbsurdApp({
    databaseUrl: cfg.databaseUrl,
    queueName: cfg.queueName,
    deps: {
      tasks: createSdkTaskClient(agent),
      github: createGithubClient(cfg),
      logger,
    },
  });
  let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;

  try {
    await app.createQueue(cfg.queueName);
    const spawned = await app.spawn(GITHUB_ISSUE_LIFECYCLE_TASK, cfg.input, {
      queue: cfg.queueName,
      idempotencyKey: `github-issue-lifecycle:${cfg.input.repo}:${cfg.input.issueNumber}:${cfg.input.correlationId ?? 'new'}`,
    });
    logger.info(
      {
        taskID: spawned.taskID,
        runID: spawned.runID,
        repo: cfg.input.repo,
        issueNumber: cfg.input.issueNumber,
        agentName: cfg.agentName,
        queueName: cfg.queueName,
        correlationId: cfg.input.correlationId,
        consoleUrl: cfg.input.consoleUrl,
      },
      'issue_lifecycle.spawned',
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
