/**
 * compose-pr-review.ts — build a `pr_review` (complexity) task spec for a
 * GitHub PR. Pure composer: emits the task spec as JSON on stdout. Does
 * NOT call the MoltNet API. The workflow pipes the output to
 * `moltnet task create`.
 *
 * Side effects
 * ------------
 * - Reads PR metadata via `gh` (needs GH_TOKEN in the env).
 * - PATCHes the PR body to embed the `<!-- legreffier-correlation: -->`
 *   marker if absent (also via `gh`, needs the same token).
 *
 * Output (stdout JSON)
 * --------------------
 *   {
 *     "taskType":      "pr_review",
 *     "correlationId": "<uuid>",
 *     "input":         <PrReviewInput, TypeBox-validated locally>
 *   }
 *
 * `teamId` and `diaryId` are intentionally NOT included — the composite
 * action that runs `moltnet task create` resolves them from the agent's
 * env at create time. Keeping creds-touching concerns out of the
 * composer is the whole point of the split.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { Rubric as RubricType } from '@moltnet/tasks';
import { PR_REVIEW_TYPE, PrReviewInput, Rubric } from '@moltnet/tasks';
import { Value } from 'typebox/value';

const { values: args } = parseArgs({
  options: {
    pr: { type: 'string', short: 'p' },
    repo: { type: 'string', short: 'r' },
    rubric: {
      type: 'string',
      default: 'rubrics/pr-complexity-binary-v1.json',
    },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args.pr || !args.repo) {
  console.error(
    'Usage: tsx tools/src/tasks/compose-pr-review.ts --pr <number> --repo <owner/repo> [--rubric <path>] [--dry-run]',
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

const rubricArg = args.rubric!;
const dryRun = args['dry-run']!;

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
        errors
          .map((e) => `  - ${e.instancePath || '(root)'}: ${e.message}`)
          .join('\n'),
    );
  }
  return parsed;
}

function validateInput(input: unknown): void {
  if (!Value.Check(PrReviewInput, input)) {
    const errors = [...Value.Errors(PrReviewInput, input)].slice(0, 5);
    throw new Error(
      'Composed PrReviewInput failed TypeBox validation:\n' +
        errors
          .map((e) => `  - ${e.instancePath || '(root)'}: ${e.message}`)
          .join('\n'),
    );
  }
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

function main() {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  const pr = getPullRequestInfo();
  const correlationId = resolveCorrelationId(pr);
  const nextBody = ensureLegreffierMarker(pr.body, correlationId);
  const rubric = readRubric(repoRoot);
  const input = buildPrReviewInput(pr, rubric);
  validateInput(input);

  if (dryRun) {
    console.error(
      `[compose] dry-run — prBodyUpdateRequired=${nextBody !== pr.body}`,
    );
  } else if (nextBody !== pr.body) {
    updatePrBody(nextBody);
  }

  process.stdout.write(
    `${JSON.stringify({ taskType: PR_REVIEW_TYPE, correlationId, input }, null, 2)}\n`,
  );
}

try {
  main();
} catch (err) {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
