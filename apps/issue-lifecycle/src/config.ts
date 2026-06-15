import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

import { getInstallationToken } from '@themoltnet/github-agent';
import type { MoltNetConfig } from '@themoltnet/sdk';

import type { GithubTokenProvider } from './github-fetch.js';
import { loadLifecycleConfig } from './lifecycle-config.js';
import type { IssueLifecycleInput } from './types.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CliConfig {
  repoRoot: string;
  agentName: string;
  agentDir: string;
  databaseUrl: string;
  queueName: string;
  githubAuth: 'moltnet-token' | 'env-token' | 'gh-cli';
  githubToken?: string;
  githubTokenProvider?: GithubTokenProvider;
  githubEnv: NodeJS.ProcessEnv;
  input: IssueLifecycleInput;
}

function requireString(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}

function readAgentEnv(agentDir: string): Record<string, string | undefined> {
  return parseEnv(readFileSync(join(agentDir, 'env'), 'utf8'));
}

function createGithubTokenProvider(agentDir: string): GithubTokenProvider {
  const raw = readFileSync(join(agentDir, 'moltnet.json'), 'utf8');
  const config = JSON.parse(raw) as MoltNetConfig;
  const github = config.github;
  if (!github?.app_id || !github.installation_id || !github.private_key_path) {
    throw new Error(
      'MoltNet GitHub auth requires github.app_id, github.installation_id, and github.private_key_path in .moltnet/<agent>/moltnet.json',
    );
  }
  return async (options) => {
    const token = await getInstallationToken({
      appId: github.app_id,
      installationId: github.installation_id,
      privateKeyPath: github.private_key_path,
      forceRefresh: options?.forceRefresh,
    });
    return token.token;
  };
}

function createLazyGithubTokenProvider(agentDir: string): GithubTokenProvider {
  let provider: GithubTokenProvider | undefined;
  return (options) => {
    provider ??= createGithubTokenProvider(agentDir);
    return provider(options);
  };
}

export function resolveGithubAuth(args: {
  mode?: string;
  envToken?: string;
  tokenProvider: GithubTokenProvider;
}): Pick<CliConfig, 'githubAuth' | 'githubToken' | 'githubTokenProvider'> {
  switch (args.mode) {
    case undefined:
    case '':
    case 'moltnet':
      return {
        githubAuth: 'moltnet-token',
        githubTokenProvider: args.tokenProvider,
      };
    case 'env':
      if (!args.envToken) {
        throw new Error(
          '--github-auth env requires GH_TOKEN or GITHUB_TOKEN to be set',
        );
      }
      return { githubAuth: 'env-token', githubToken: args.envToken };
    case 'gh-cli':
      return { githubAuth: 'gh-cli' };
    default:
      throw new Error('--github-auth must be one of: moltnet, env, gh-cli');
  }
}

export function parseCliConfig(argv = process.argv.slice(2)): CliConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string' },
      issue: { type: 'string' },
      agent: { type: 'string', default: 'legreffier' },
      'team-id': { type: 'string' },
      'diary-id': { type: 'string' },
      'correlation-id': { type: 'string' },
      'console-url': { type: 'string' },
      'database-url': { type: 'string' },
      'queue-name': { type: 'string', default: 'issue-lifecycle' },
      'approval-label': { type: 'string' },
      'ready-for-review-label': { type: 'string' },
      'skip-notify-label': { type: 'string' },
      'github-auth': { type: 'string' },
      'poll-interval-sec': { type: 'string' },
      'max-pr-pending-polls': { type: 'string' },
      'profiles-config': { type: 'string' },
    },
  });

  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const agentName = values.agent;
  const agentDir = join(repoRoot, '.moltnet', agentName);
  const agentEnv = readAgentEnv(agentDir);

  const issueNumber = Number(values.issue);
  if (!Number.isInteger(issueNumber) || issueNumber < 1) {
    throw new Error('--issue must be a positive integer');
  }
  if (values['correlation-id'] && !UUID_RE.test(values['correlation-id'])) {
    throw new Error('--correlation-id must be a UUID');
  }
  const pollIntervalSec = values['poll-interval-sec']
    ? Number(values['poll-interval-sec'])
    : undefined;
  if (
    pollIntervalSec !== undefined &&
    (!Number.isFinite(pollIntervalSec) || pollIntervalSec < 1)
  ) {
    throw new Error('--poll-interval-sec must be a positive number');
  }
  const maxPrPendingPolls = values['max-pr-pending-polls']
    ? Number(values['max-pr-pending-polls'])
    : undefined;
  if (
    maxPrPendingPolls !== undefined &&
    (!Number.isInteger(maxPrPendingPolls) || maxPrPendingPolls < 1)
  ) {
    throw new Error('--max-pr-pending-polls must be a positive integer');
  }

  const databaseUrl =
    values['database-url'] ?? process.env.ISSUE_LIFECYCLE_DATABASE_URL;
  const consoleUrl =
    values['console-url'] ??
    process.env.ISSUE_LIFECYCLE_CONSOLE_URL ??
    process.env.CONSOLE_BASE_URL;
  const githubAuth =
    values['github-auth'] ?? process.env.ISSUE_LIFECYCLE_GITHUB_AUTH;
  const github = resolveGithubAuth({
    mode: githubAuth,
    envToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    tokenProvider: createLazyGithubTokenProvider(agentDir),
  });

  const correlationId = values['correlation-id'] ?? randomUUID();

  // Optional per-step runtime profile + task-attempt config. Loaded and
  // validated here so a malformed file fails before any task is created.
  const lifecycleConfig = loadLifecycleConfig(
    values['profiles-config'] ?? process.env.ISSUE_LIFECYCLE_PROFILES_CONFIG,
  );
  const hasLifecycleConfig = Object.keys(lifecycleConfig).length > 0;

  return {
    repoRoot,
    agentName,
    agentDir,
    databaseUrl: requireString(
      databaseUrl,
      '--database-url or ISSUE_LIFECYCLE_DATABASE_URL',
    ),
    queueName: values['queue-name'],
    ...github,
    githubEnv: { ...process.env },
    input: {
      repo: requireString(values.repo, '--repo'),
      issueNumber,
      teamId:
        values['team-id'] ??
        requireString(agentEnv.MOLTNET_TEAM_ID, 'MOLTNET_TEAM_ID'),
      diaryId:
        values['diary-id'] ??
        requireString(agentEnv.MOLTNET_DIARY_ID, 'MOLTNET_DIARY_ID'),
      correlationId,
      ...(consoleUrl ? { consoleUrl } : {}),
      ...(values['approval-label']
        ? { approvalLabel: values['approval-label'] }
        : {}),
      ...(values['ready-for-review-label']
        ? { readyForReviewLabel: values['ready-for-review-label'] }
        : {}),
      ...(values['skip-notify-label']
        ? { skipNotifyLabel: values['skip-notify-label'] }
        : {}),
      ...(pollIntervalSec !== undefined ? { pollIntervalSec } : {}),
      ...(maxPrPendingPolls !== undefined ? { maxPrPendingPolls } : {}),
      ...(hasLifecycleConfig ? { lifecycleConfig } : {}),
    },
  };
}
