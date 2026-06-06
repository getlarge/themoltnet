import { connect } from '@themoltnet/sdk';
import pino from 'pino';

import {
  createIssueLifecycleAbsurdApp,
  GITHUB_ISSUE_LIFECYCLE_TASK,
} from './absurd.js';
import { parseCliConfig } from './config.js';
import { GhCliGithubClient } from './github-cli.js';
import { createSdkTaskClient } from './sdk-task-client.js';

async function main(): Promise<number> {
  const cfg = parseCliConfig();
  const logger = pino({ name: 'issue-lifecycle' });
  const agent = await connect({ configDir: cfg.agentDir });
  const app = createIssueLifecycleAbsurdApp({
    databaseUrl: cfg.databaseUrl,
    queueName: cfg.queueName,
    deps: {
      tasks: createSdkTaskClient(agent),
      github: new GhCliGithubClient({
        token: cfg.githubToken,
        cwd: cfg.repoRoot,
        env: cfg.githubEnv,
      }),
      logger,
    },
  });

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
    },
    'issue_lifecycle.spawned',
  );

  const worker = await app.startWorker({ concurrency: 1 });
  const result = await app.awaitTaskResult(spawned.taskID);
  await worker.close();
  await app.close();

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  return result.state === 'completed' ? 0 : 1;
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
