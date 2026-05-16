/**
 * create-pr-review.ts — impose a generic `pr_review` task for a GitHub PR.
 *
 * Scope boundary
 * --------------
 * This script is imposer-only. It MAY:
 * - inspect PR metadata needed to build task input
 * - recover or mint a correlationId
 * - persist the LeGreffier PR-body marker
 * - create the task via `agent.tasks.create(...)`
 *
 * It MUST NOT:
 * - claim the task
 * - start the daemon
 * - execute the review
 * - post the review comment itself
 *
 * Any PR comment is part of the claimant's execution contract and is
 * delegated to the `pr_review` prompt via repo-specific `inspectionHints`.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

import type { Rubric as RubricType } from '@moltnet/tasks';
import { PR_REVIEW_TYPE, type PrReviewInput, Rubric } from '@moltnet/tasks';
import { Value } from '@sinclair/typebox/value';
import { connect } from '@themoltnet/sdk';

const { values: args } = parseArgs({
  options: {
    pr: { type: 'string', short: 'p' },
    repo: { type: 'string', short: 'r' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    rubric: {
      type: 'string',
      default: 'rubrics/pr-complexity-binary-v1.json',
    },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args.pr || !args.repo) {
  console.error(
    'Usage: tsx tools/src/tasks/create-pr-review.ts --pr <number> --repo <owner/repo> [--agent <name>] [--rubric <path>] [--dry-run]',
  );
  process.exit(1);
}

const prNumber = Number(args.pr);
if (!Number.isInteger(prNumber) || prNumber < 1) {
  console.error(`Invalid --pr "${args.pr}": must be a positive integer.`);
  process.exit(1);
}

const repoSlug = args.repo!;
if (!/^[^/\s]+\/[^/\s]+$/.test(repoSlug)) {
  console.error(`Invalid --repo "${repoSlug}": expected owner/repo.`);
  process.exit(1);
}

const agentName = args.agent!;
const rubricArg = args.rubric!;
const dryRun = args['dry-run']!;

if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  console.error(
    `Invalid --agent "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
  );
  process.exit(1);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRANCH_RE = /^moltnet\/([0-9a-f-]{36})\//i;
const TRAILER_RE = /^Moltnet-Correlation-Id:\s*([0-9a-f-]{36})\s*$/im;
const MOLTNET_MARKER_RE =
  /<!--\s*moltnet-correlation:\s*([0-9a-f-]{36})\s*-->/i;
const LEGREFFIER_MARKER_RE =
  /<!--\s*legreffier-correlation:\s*([0-9a-f-]{36})\s*-->/i;

interface PullRequestInfo {
  title: string;
  body: string;
  url: string;
  headRefName: string;
  commitMessages: string[];
}

function ghJson<T>(ghArgs: string[]): T {
  const out = execFileSync('gh', ghArgs, {
    encoding: 'utf8',
    env: process.env,
  });
  return JSON.parse(out) as T;
}

function gh(ghArgs: string[]): string {
  return execFileSync('gh', ghArgs, {
    encoding: 'utf8',
    env: process.env,
  });
}

function getPullRequestInfo(): PullRequestInfo {
  const pr = ghJson<{
    title: string;
    body: string | null;
    url: string;
    headRefName: string;
    commits: Array<{ messageHeadline: string; messageBody?: string | null }>;
  }>([
    'pr',
    'view',
    String(prNumber),
    '--repo',
    repoSlug,
    '--json',
    'title,body,url,headRefName,commits',
  ]);

  return {
    title: pr.title,
    body: pr.body ?? '',
    url: pr.url,
    headRefName: pr.headRefName,
    commitMessages: pr.commits.map((commit) =>
      [commit.messageHeadline, commit.messageBody ?? '']
        .filter((part) => part.length > 0)
        .join('\n\n'),
    ),
  };
}

function resolveCorrelationId(pr: PullRequestInfo): string {
  const branchMatch = pr.headRefName.match(BRANCH_RE);
  if (branchMatch) return branchMatch[1];

  for (const message of pr.commitMessages) {
    const trailerMatch = message.match(TRAILER_RE);
    if (trailerMatch) return trailerMatch[1];
  }

  const legreffierMarkerMatch = pr.body.match(LEGREFFIER_MARKER_RE);
  if (legreffierMarkerMatch) return legreffierMarkerMatch[1];

  const moltnetMarkerMatch = pr.body.match(MOLTNET_MARKER_RE);
  if (moltnetMarkerMatch) return moltnetMarkerMatch[1];

  return randomUUID();
}

function ensureLegreffierMarker(body: string, correlationId: string): string {
  if (!UUID_RE.test(correlationId)) {
    throw new Error(`Invalid correlationId "${correlationId}"`);
  }

  const marker = `<!-- legreffier-correlation: ${correlationId} -->`;
  if (LEGREFFIER_MARKER_RE.test(body)) {
    return body.replace(LEGREFFIER_MARKER_RE, marker);
  }

  const trimmed = body.trimEnd();
  return trimmed.length > 0 ? `${trimmed}\n\n${marker}\n` : `${marker}\n`;
}

function updatePrBody(body: string): void {
  gh([
    'api',
    `repos/${repoSlug}/pulls/${prNumber}`,
    '--method',
    'PATCH',
    '--raw-field',
    `body=${body}`,
  ]);
}

function readRubric(repoRoot: string): RubricType {
  const rubricPath = isAbsolute(rubricArg)
    ? rubricArg
    : resolve(repoRoot, rubricArg);
  const parsed = JSON.parse(readFileSync(rubricPath, 'utf8')) as unknown;
  if (!Value.Check(Rubric, parsed)) {
    const errors = [...Value.Errors(Rubric, parsed)].slice(0, 5);
    throw new Error(
      `Rubric at ${rubricPath} does not match the @moltnet/tasks Rubric schema.\n` +
        errors.map((e) => `  - ${e.path || '(root)'}: ${e.message}`).join('\n'),
    );
  }
  return parsed;
}

function buildPrReviewInput(
  pr: PullRequestInfo,
  rubric: RubricType,
): PrReviewInput {
  return {
    subject: {
      title: `PR #${prNumber}: ${pr.title}`,
      summary:
        `This subject is the GitHub pull request at ${pr.url}. ` +
        `Review its complexity and reviewability, not functional correctness.`,
      resourceUrls: [pr.url],
      inspectionHints: [
        'Use the local checkout to read touched files and surrounding code as needed.',
      ],
    },
    taskPrompt: [
      'This review target is a GitHub pull request.',
      '',
      `1. Inspect the PR with \`gh pr view ${prNumber} --repo ${repoSlug}\` and \`gh pr diff ${prNumber} --repo ${repoSlug}\`.`,
      '2. Use the local checkout to inspect the touched files and enough surrounding code to judge reviewer burden.',
      `3. Before your final structured output, post exactly one advisory PR comment with \`gh pr comment ${prNumber} --repo ${repoSlug} --body <review>\`.`,
      '4. That PR comment must include the composite score, the overall verdict, each criterion as pass/fail, and concise rationale explaining the main complexity drivers.',
      '5. This is a complexity/reviewability judgment, not a correctness review.',
    ].join('\n'),
    successCriteria: {
      version: 1,
      rubric,
    },
  };
}

async function main() {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const agentDir = join(repoRoot, '.moltnet', agentName);
  const envRaw = readFileSync(join(agentDir, 'env'), 'utf8');
  const envMap = parseEnv(envRaw);
  const teamId = envMap['MOLTNET_TEAM_ID'] ?? process.env['MOLTNET_TEAM_ID'];
  const diaryId = envMap['MOLTNET_DIARY_ID'] ?? process.env['MOLTNET_DIARY_ID'];
  if (!teamId) {
    throw new Error(
      `Missing MOLTNET_TEAM_ID in ${join(agentDir, 'env')} and process environment`,
    );
  }
  if (!diaryId) {
    throw new Error(
      `Missing MOLTNET_DIARY_ID in ${join(agentDir, 'env')} and process environment`,
    );
  }

  const pr = getPullRequestInfo();
  const correlationId = resolveCorrelationId(pr);
  const nextBody = ensureLegreffierMarker(pr.body, correlationId);
  const rubric = readRubric(repoRoot);
  const input = buildPrReviewInput(pr, rubric);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          taskType: PR_REVIEW_TYPE,
          teamId,
          diaryId,
          correlationId,
          input,
          prBodyUpdateRequired: nextBody !== pr.body,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (nextBody !== pr.body) {
    updatePrBody(nextBody);
  }

  const agent = await connect({ configDir: agentDir });
  const task = await agent.tasks.create({
    taskType: PR_REVIEW_TYPE,
    teamId,
    diaryId,
    correlationId,
    input: input as unknown as Record<string, unknown>,
  });

  console.error(
    `[task] created ${task.id} (status=${task.status}) correlationId=${correlationId}`,
  );
  console.log(
    JSON.stringify(
      { id: task.id, status: task.status, correlationId },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
