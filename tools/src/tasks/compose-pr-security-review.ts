/**
 * compose-pr-security-review.ts — build a `pr_review` task spec for a
 * security-focused review of a GitHub PR.
 *
 * Mirrors compose-pr-review.ts (complexity) but binds:
 *
 *   - a security-focused rubric (`rubrics/pr-security-v1.json`)
 *   - a taskPrompt that steers the claimant through the security pipeline
 *   - the `security-review` skill bytes via `input.context[]`, so the
 *     runtime advertises it in `<available_skills>` and the agent
 *     loads the body on demand via Read
 *
 * No new task type — reuses `pr_review`. The schema's optional `context`
 * field carries the skill payload; the runtime's `injectTaskContext`
 * handles delivery into the Pi VM.
 *
 * Pure composer: emits the task spec as JSON on stdout. Does NOT call
 * the MoltNet API. The workflow pipes the output to `moltnet task create`.
 *
 * Side effects (same as compose-pr-review): reads PR via `gh`, PATCHes
 * the PR body to embed the correlation marker. Needs GH_TOKEN, not
 * MoltNet creds.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { ContextRef, Rubric as RubricType } from '@moltnet/tasks';
import { PR_REVIEW_TYPE, PrReviewInput, Rubric } from '@moltnet/tasks';
import { Value } from '@sinclair/typebox/value';

const { values: args } = parseArgs({
  options: {
    pr: { type: 'string', short: 'p' },
    repo: { type: 'string', short: 'r' },
    rubric: {
      type: 'string',
      default: 'rubrics/pr-security-v1.json',
    },
    skill: {
      type: 'string',
      default: 'skills/security-review/SKILL.md',
    },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args.pr || !args.repo) {
  console.error(
    'Usage: tsx tools/src/tasks/compose-pr-security-review.ts --pr <number> --repo <owner/repo> ' +
      '[--rubric <path>] [--skill <path>] [--dry-run]',
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
const skillArg = args.skill!;
const dryRun = args['dry-run']!;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRANCH_RE = /^moltnet\/([0-9a-f-]{36})\//i;
const TRAILER_RE = /^Moltnet-Correlation-Id:\s*([0-9a-f-]{36})\s*$/im;
const MOLTNET_MARKER_RE =
  /<!--\s*moltnet-correlation:\s*([0-9a-f-]{36})\s*-->/i;
const LEGREFFIER_MARKER_RE =
  /<!--\s*legreffier-correlation:\s*([0-9a-f-]{36})\s*-->/i;

// Mirror ContextRef.content cap so we fail at compose time rather than
// surfacing a TypeBox error from the agent runtime.
const MAX_SKILL_BYTES = 65_536;
const SKILL_SLUG = 'security-review';

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

function readSkill(repoRoot: string): ContextRef {
  const skillPath = isAbsolute(skillArg)
    ? skillArg
    : resolve(repoRoot, skillArg);
  const size = statSync(skillPath).size;
  if (size > MAX_SKILL_BYTES) {
    throw new Error(
      `Skill at ${skillPath} is ${size} bytes; ContextRef.content caps at ${MAX_SKILL_BYTES}.`,
    );
  }
  const content = readFileSync(skillPath, 'utf8');
  return { slug: SKILL_SLUG, binding: 'skill', content };
}

function buildPrSecurityReviewInput(
  pr: PullRequestInfo,
  rubric: RubricType,
  skillRef: ContextRef,
): PrReviewInput {
  return {
    subject: {
      title: `Security review — PR #${prNumber}: ${pr.title}`,
      summary:
        `This subject is the GitHub pull request at ${pr.url}. ` +
        `Perform a security-focused review of the diff. Complement Semgrep — ` +
        `focus on logic and data-flow issues a static analyzer would miss.`,
      resourceUrls: [pr.url],
      inspectionHints: [
        `Follow the \`${SKILL_SLUG}\` skill advertised in <available_skills> — its pipeline is mandatory, not optional.`,
        'Read the diff and surrounding code: authn/authz paths (Ory JWT, Keto), Ed25519 key handling, TypeBox boundary schemas, dotenvx-managed secrets.',
        'Each finding in the PR comment must include a severity (critical/high/medium/low/info), a data-flow chain, and a concrete remediation.',
      ],
    },
    taskPrompt: [
      `This is a **security-focused** review of GitHub PR #${prNumber} on ${repoSlug}.`,
      '',
      `STEP 0 (mandatory, before anything else): use the Read tool to load the \`${SKILL_SLUG}\` skill advertised in <available_skills>. Its <location> attribute contains the absolute path to SKILL.md. The skill defines the pipeline (recon → hunt → self-validate → trace → dedup → report) you MUST follow — it is not optional context, it is the procedure for this task.`,
      '',
      'After loading the skill:',
      `1. Inspect the PR with \`gh pr view ${prNumber} --repo ${repoSlug}\` and \`gh pr diff ${prNumber} --repo ${repoSlug}\`.`,
      '2. Use the local checkout to read touched files and enough surrounding code to judge risk in context.',
      '3. Run each pipeline phase from the skill explicitly. Do not skip phases on small diffs.',
      `4. Post exactly one advisory PR comment with \`gh pr comment ${prNumber} --repo ${repoSlug} --body <review>\` before emitting your structured output.`,
      '5. The review is advisory — do not block the PR, do not duplicate Semgrep findings (cite the rule and move on).',
    ].join('\n'),
    successCriteria: {
      version: 1,
      rubric,
    },
    context: [skillRef],
  };
}

function validateInput(input: unknown): void {
  if (!Value.Check(PrReviewInput, input)) {
    const errors = [...Value.Errors(PrReviewInput, input)].slice(0, 5);
    throw new Error(
      'Composed PrReviewInput failed TypeBox validation:\n' +
        errors.map((e) => `  - ${e.path || '(root)'}: ${e.message}`).join('\n'),
    );
  }
}

function main() {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  const pr = getPullRequestInfo();
  const correlationId = resolveCorrelationId(pr);
  const nextBody = ensureLegreffierMarker(pr.body, correlationId);
  const rubric = readRubric(repoRoot);
  const skillRef = readSkill(repoRoot);
  const input = buildPrSecurityReviewInput(pr, rubric, skillRef);
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
