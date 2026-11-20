import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';

import { type CliDeps, type PullRequest, pullRequestFiles } from './cli.js';
import { env, required } from './config.js';
import { githubChildEnvironment } from './github-environment.js';
import { createGraphQL, fetchReviewThreads } from './threads.js';

export function createReviewCliDeps(
  source: NodeJS.ProcessEnv = env(),
  cwd = process.cwd(),
  token: () => Promise<string> = () =>
    Promise.resolve(required('GH_TOKEN', source)),
): CliDeps {
  const gh = async (args: string[]) => {
    const { stdout } = await promisify(execFile)('gh', args, {
      cwd,
      env: githubChildEnvironment(source, await token()),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30_000,
    });
    return stdout;
  };
  return {
    env: source,
    cwd,
    github: {
      reviewThreads: async (repo, pr) =>
        fetchReviewThreads(
          createGraphQL(await token(), source.GITHUB_GRAPHQL_URL || undefined),
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
}
