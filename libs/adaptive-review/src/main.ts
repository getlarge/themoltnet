import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { PullRequestFile } from '@moltnet/docs-impact-review/eligibility';
import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';

import { type CliDeps, runAdaptiveStage } from './cli.js';
import { env, required } from './config.js';
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

/** `gh api --paginate --jq` output: one JSON value per line. */
function jsonLines<T>(stdout: string): T[] {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/** Watches this run's worker jobs; absent outside GitHub Actions. */
function runWorkerLiveness(): WorkerLiveness | undefined {
  const { GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT } = env();
  if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID) return undefined;
  const path = `repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT || '1'}/jobs?per_page=100`;
  let reported = false;
  return workflowWorkerLiveness({
    profiles: {
      docs: env().ADAPTIVE_DOCS_PROFILE || undefined,
      complexity: env().ADAPTIVE_COMPLEXITY_PROFILE || undefined,
      security: env().ADAPTIVE_SECURITY_PROFILE || undefined,
      focused: env().ADAPTIVE_FOCUSED_PROFILE || undefined,
    },
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
    onLookupError() {
      // Liveness is advisory: keep waiting on the task budgets instead.
      if (reported) return;
      reported = true;
      process.stderr.write(
        'Adaptive worker liveness unavailable; waiting on task budgets.\n',
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
      return jsonLines<PullRequestFile>(
        await gh([
          'api',
          '--paginate',
          `repos/${repo}/pulls/${pr}/files?per_page=100`,
          '--jq',
          '.[] | {filename} + (if .previous_filename then {previous_filename} else {} end)',
        ]),
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

Promise.resolve()
  .then(() => runAdaptiveStage(required('ADAPTIVE_STAGE'), deps))
  .then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    },
  );
