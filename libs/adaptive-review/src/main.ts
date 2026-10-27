import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { workflowCommandValue } from '@moltnet/docs-impact-review/workflow-command';
import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';

import {
  type CliDeps,
  jsonLines,
  PROFILE_ENV,
  pullRequestFiles,
  reportStageFailure,
  runAdaptiveStage,
} from './cli.js';
import { env } from './config.js';
import {
  type WorkerJob,
  type WorkerLiveness,
  workflowWorkerLiveness,
} from './workers.js';

async function gh(args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)('gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** Watches this run's worker jobs; absent outside GitHub Actions. */
function runWorkerLiveness(): WorkerLiveness | undefined {
  const { GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT } = env();
  if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID) return undefined;
  const path = `repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT || '1'}/jobs?per_page=100`;
  let reported = false;
  return workflowWorkerLiveness({
    profiles: Object.fromEntries(
      Object.entries(PROFILE_ENV).map(([pool, name]) => [
        pool,
        env()[name] || undefined,
      ]),
    ),
    async listJobs() {
      return jsonLines<WorkerJob>(
        await gh([
          'api',
          '--paginate',
          path,
          '--jq',
          '.jobs[] | {name, status}',
        ]),
      );
    },
    onLookupError(error) {
      // Liveness is advisory: keep waiting on the task budgets instead.
      if (reported) return;
      reported = true;
      const cause = (error instanceof Error ? error.message : String(error))
        .trim()
        .split('\n')
        .at(-1)
        ?.slice(0, 200);
      process.stdout.write(
        `::warning::Adaptive worker liveness unavailable (${workflowCommandValue(cause ?? 'unknown error')}); waiting on task budgets.\n`,
      );
    },
  });
}

const deps: CliDeps = {
  env: env(),
  cwd: process.cwd(),
  github: {
    async revisions(repo, pr) {
      const current = JSON.parse(
        await gh([
          'pr',
          'view',
          String(pr),
          '--repo',
          repo,
          '--json',
          'headRefOid,baseRefOid',
        ]),
      ) as { headRefOid: string; baseRefOid: string };
      return { head: current.headRefOid, base: current.baseRefOid };
    },
    async files(repo, pr) {
      return pullRequestFiles(
        JSON.parse(
          await gh([
            'api',
            '--paginate',
            '--slurp',
            `repos/${repo}/pulls/${pr}/files?per_page=100`,
          ]),
        ),
      );
    },
  },
  async connect() {
    const agent = await connect();
    return {
      async profiles(teamId) {
        return (await agent.runtimeProfiles.list({ teamId })).items;
      },
      tasks: createSdkTaskClient(agent),
    };
  },
  workers: runWorkerLiveness,
  stdout: (text) => process.stdout.write(text),
};

async function main(): Promise<void> {
  const stage = env().ADAPTIVE_STAGE;
  try {
    process.exitCode = await runAdaptiveStage(stage ?? '', deps);
  } catch (error) {
    process.exitCode = reportStageFailure(stage, error, {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    });
  }
}

void main();
