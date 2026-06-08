import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

import type { IssueLifecycleInput } from './types.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CliConfig {
  repoRoot: string;
  agentName: string;
  agentDir: string;
  databaseUrl: string;
  queueName: string;
  githubToken?: string;
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

function getGithubToken(agentDir: string): string {
  return execFileSync(
    'moltnet',
    ['github', 'token', '--credentials', join(agentDir, 'moltnet.json')],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
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
      'dry-run': { type: 'boolean', default: false },
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

  const databaseUrl =
    values['database-url'] ?? process.env.ISSUE_LIFECYCLE_DATABASE_URL;
  const consoleUrl =
    values['console-url'] ??
    process.env.ISSUE_LIFECYCLE_CONSOLE_URL ??
    process.env.CONSOLE_BASE_URL;
  const githubAuth =
    values['github-auth'] ?? process.env.ISSUE_LIFECYCLE_GITHUB_AUTH;
  const githubToken =
    githubAuth === 'gh-cli'
      ? undefined
      : process.env.GH_TOKEN ||
        process.env.GITHUB_TOKEN ||
        getGithubToken(agentDir);

  const correlationId = values['correlation-id'] ?? randomUUID();

  return {
    repoRoot,
    agentName,
    agentDir,
    databaseUrl: requireString(
      databaseUrl,
      '--database-url or ISSUE_LIFECYCLE_DATABASE_URL',
    ),
    queueName: values['queue-name'],
    githubToken,
    githubEnv: { ...process.env, GH_TOKEN: githubToken },
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
      ...(values['poll-interval-sec']
        ? { pollIntervalSec: Number(values['poll-interval-sec']) }
        : {}),
    },
  };
}
