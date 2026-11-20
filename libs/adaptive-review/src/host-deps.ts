import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { PullRequestFile } from '@moltnet/docs-impact-review/eligibility';
import { connect } from '@themoltnet/sdk/node';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';

import { env, required } from './config.js';
import { githubChildEnvironment } from './github-environment.js';
import {
  createGraphQL,
  fetchReviewThreads,
  type ReviewThread,
} from './threads.js';

export function createReviewHostDeps(
  source: NodeJS.ProcessEnv = env(),
  cwd = process.cwd(),
  token: () => Promise<string> = () =>
    Promise.resolve(required('GH_TOKEN', source)),
): ReviewHostDeps {
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
  };
}

export interface PinnedPullRequest {
  repo: string;
  pr: number;
  title: string;
  body: string;
  base: string;
  head: string;
  correlationId: string;
}

/** Process boundaries of the standalone review host, injectable for tests. */
export interface ReviewHostDeps {
  github: {
    reviewThreads(repo: string, pr: number): Promise<ReviewThread[]>;
    revisions(
      repo: string,
      pr: number,
    ): Promise<{ head: string; base: string }>;
    files(repo: string, pr: number): Promise<PullRequestFile[]>;
    /** The pull request a comment event names only by number. */
    pullRequest(repo: string, pr: number): Promise<PullRequest>;
  };
  connect(
    this: void,
    teamId: string,
    signal?: AbortSignal,
  ): Promise<{
    profiles(
      teamId: string,
    ): Promise<Array<{ id: string; name: string; revision: number }>>;
    tasks: TaskClient;
  }>;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  changed_files: number;
  user: { login: string };
  base: { sha: string };
  head: { sha: string; repo: { full_name: string } | null };
}

/** Keeps the fields of a pull request files API page the trust gate reads. */
export function pullRequestFiles(pages: unknown): PullRequestFile[] {
  if (!Array.isArray(pages)) throw new Error('unexpected pull request files');
  return pages.flat().map((item: unknown) => {
    const file = item as { filename?: unknown; previous_filename?: unknown };
    if (typeof file.filename !== 'string')
      throw new Error('pull request file has no filename');
    return typeof file.previous_filename === 'string'
      ? { filename: file.filename, previous_filename: file.previous_filename }
      : { filename: file.filename };
  });
}
