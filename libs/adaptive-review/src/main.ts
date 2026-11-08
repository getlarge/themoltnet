import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';

import {
  type CliDeps,
  type PullRequest,
  pullRequestFiles,
  reportStageFailure,
  runAdaptiveStage,
} from './cli.js';
import { env, required } from './config.js';
import { createGraphQL, fetchReviewThreads } from './threads.js';

async function gh(args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)('gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

const deps: CliDeps = {
  env: env(),
  cwd: process.cwd(),
  github: {
    reviewThreads: (repo, pr) =>
      fetchReviewThreads(
        createGraphQL(
          required('GH_TOKEN', env()),
          env().GITHUB_GRAPHQL_URL || undefined,
        ),
        repo,
        pr,
      ),
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
    async pullRequest(repo, pr) {
      return JSON.parse(
        await gh(['api', `repos/${repo}/pulls/${pr}`]),
      ) as PullRequest;
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
  async connect(teamId, signal) {
    const agent = await connect({ signal });
    return {
      async profiles(teamId) {
        return (await agent.runtimeProfiles.list({ teamId })).items;
      },
      tasks: {
        ...createSdkTaskClient(agent),
        listAttempts: (id) => agent.tasks.listAttempts(id, { teamId }),
      },
    };
  },
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
