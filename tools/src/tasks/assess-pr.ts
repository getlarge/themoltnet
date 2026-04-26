/**
 * assess-pr.ts — synthesize an `assess_brief` task that judges a GitHub
 * pull request against the PR-complexity rubric.
 *
 * What it does
 * ------------
 * Reads `gh pr view <ref>` (using the agent's GitHub App token), turns
 * the PR metadata into an `AssessBriefInput` carrying the inline
 * `pr-complexity-v1` rubric criteria, and POSTs it via
 * `agent.tasks.create(...)`. Prints the new task id on stdout. The task
 * lands queued; any daemon polling for `assess_brief` claims it.
 *
 * Why this is the same task type as fulfill-brief assessment
 * ----------------------------------------------------------
 * `assess_brief` is generic over the rubric. PR review is just an
 * `assess_brief` instance with the PR-complexity rubric inlined and
 * `references[]` pointing at the PR. No new task type, no new
 * executor — the daemon's existing pi-coding-agent runs the judge
 * inside Gondolin against the rubric.
 *
 * Prerequisites
 * -------------
 * - `.moltnet/<agent>/` populated with `moltnet.json` and `env`
 *   (at minimum `MOLTNET_TEAM_ID` and `MOLTNET_DIARY_ID`)
 * - `gh` CLI on PATH
 * - The daemon's `sandbox.json` must include `api.github.com` in
 *   `allowedHosts` so the executor can call `gh pr diff` from inside
 *   the VM.
 *
 * Usage
 * -----
 *   pnpm --filter @moltnet/tools task:assess-pr --pr 123
 *   pnpm --filter @moltnet/tools task:assess-pr --pr https://github.com/getlarge/themoltnet/pull/123
 *   pnpm --filter @moltnet/tools task:assess-pr --pr 123 --dry-run
 *
 * Flags
 * -----
 *   -p, --pr        GitHub PR number or URL (required)
 *   -a, --agent     MoltNet agent name (default: legreffier)
 *       --dry-run   Print the synthesized Task input + skip the POST.
 *
 * Exit codes
 * ----------
 *   0 — task created (or dry-run completed)
 *   1 — bad args, missing creds, missing MOLTNET_TEAM_ID, gh failure, API error
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

import {
  ASSESS_BRIEF_TYPE,
  type AssessBriefInput,
  PR_COMPLEXITY_V1_CRITERIA,
  PR_COMPLEXITY_V1_PREAMBLE,
} from '@moltnet/tasks';
import { connect } from '@themoltnet/sdk';

const { values: args } = parseArgs({
  options: {
    pr: { type: 'string', short: 'p' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args.pr) {
  console.error(
    'Usage: tsx tools/src/tasks/assess-pr.ts --pr <number|url> [--agent <name>] [--dry-run]',
  );
  process.exit(1);
}

const prRef = args.pr;
const agentName = args.agent!;
const dryRun = args['dry-run']!;

if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  console.error(
    `Invalid --agent "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
  );
  process.exit(1);
}

function getAgentGhToken(agentDir: string): string {
  const credsPath = join(agentDir, 'moltnet.json');
  try {
    return execFileSync(
      'npx',
      ['@themoltnet/cli', 'github', 'token', '--credentials', credsPath],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch (err) {
    throw new Error(
      `Failed to resolve agent GH token from ${credsPath}. ` +
        'Refusing to fall back to human auth context. ' +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

interface GhPr {
  number: number;
  title: string;
  body: string;
  url: string;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  author: { login: string };
  labels: { name: string }[];
  files: { path: string; additions: number; deletions: number }[];
  commits: { oid: string; messageHeadline: string }[];
}

function fetchPr(cwd: string, ghToken: string): GhPr {
  const raw = execFileSync(
    'gh',
    [
      'pr',
      'view',
      prRef,
      '--json',
      // Field set is intentionally focused on what the rubric criteria
      // need to reason about: scope (files/commits), naming (title,
      // body), author, branches.
      'number,title,body,url,headRefOid,headRefName,baseRefName,author,labels,files,commits',
    ],
    {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, GH_TOKEN: ghToken },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(raw) as GhPr;
}

function buildPreamble(pr: GhPr): string {
  // Layered: rubric preamble (judge persona + scoring rules) on top,
  // then the concrete PR metadata so the judge has it without an
  // extra fetch. The judge is still expected to run `gh pr diff` for
  // the actual change content.
  const fileSummary =
    pr.files.length > 20
      ? `${pr.files.length} files changed (showing first 20):\n` +
        pr.files
          .slice(0, 20)
          .map((f) => `  - ${f.path} (+${f.additions}/-${f.deletions})`)
          .join('\n')
      : pr.files
          .map((f) => `  - ${f.path} (+${f.additions}/-${f.deletions})`)
          .join('\n');

  const commitSummary = pr.commits
    .slice(0, 10)
    .map((c) => `  - ${c.oid.slice(0, 7)} ${c.messageHeadline}`)
    .join('\n');

  const labelList = pr.labels.length
    ? `Labels: ${pr.labels.map((l) => l.name).join(', ')}`
    : '';

  return [
    PR_COMPLEXITY_V1_PREAMBLE,
    '',
    '## Pull request under review',
    '',
    `**${pr.title}**`,
    `URL: ${pr.url}`,
    `Branch: \`${pr.headRefName}\` → \`${pr.baseRefName}\` (head: ${pr.headRefOid.slice(0, 7)})`,
    `Author: @${pr.author.login}`,
    labelList,
    '',
    '### Description',
    '',
    pr.body || '_No description provided._',
    '',
    '### Files',
    '',
    fileSummary || '_No files changed (empty PR?)._',
    '',
    '### Commits',
    '',
    commitSummary || '_No commits._',
    '',
    'Use `gh pr diff ' +
      String(pr.number) +
      '` inside the sandbox to read the actual diff before scoring.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  const cwd = process.cwd();
  const mainRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const agentDir = join(mainRepo, '.moltnet', agentName);
  const envRaw = readFileSync(join(agentDir, 'env'), 'utf8');
  const envMatches = parseEnv(envRaw);
  const teamId = envMatches['MOLTNET_TEAM_ID'];
  if (!teamId) {
    throw new Error(
      `Missing MOLTNET_TEAM_ID in ${join(agentDir, 'env')}. ` +
        'Run the agent onboarding flow to populate the env file.',
    );
  }
  const diaryId = envMatches['MOLTNET_DIARY_ID'];
  if (!diaryId) {
    throw new Error(
      `Missing MOLTNET_DIARY_ID in ${join(agentDir, 'env')}. ` +
        'The Tasks API requires a diary id on every task. Set ' +
        'MOLTNET_DIARY_ID to the diary that should own this assessment.',
    );
  }

  console.error(`[pr] Fetching #${prRef}...`);
  const ghToken = getAgentGhToken(agentDir);
  const pr = fetchPr(cwd, ghToken);
  console.error(`[pr] #${pr.number}: ${pr.title}`);

  // assess_brief.input.targetTaskId is required by the schema. We don't
  // have a fulfill_brief target — a PR isn't a fulfill_brief result.
  // Use the all-zeros UUID as a sentinel: judges should consult the
  // `references[]` (which points to the PR via external metadata)
  // rather than dereferencing the target as a task id. The rubric
  // preamble + the PR metadata embedded in the preamble carry the
  // actual context.
  //
  // TODO: extend AssessBriefInput to support a non-task target
  // (kind: 'pull_request') so we don't have to use a sentinel id.
  // Tracked alongside the prompt-discriminator follow-up in #951.
  const SENTINEL_TARGET_TASK_ID = '00000000-0000-0000-0000-000000000000';

  const input: AssessBriefInput = {
    targetTaskId: SENTINEL_TARGET_TASK_ID,
    criteria: [...PR_COMPLEXITY_V1_CRITERIA],
    rubricPreamble: buildPreamble(pr),
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          taskType: ASSESS_BRIEF_TYPE,
          teamId,
          diaryId,
          input,
          references: [
            {
              taskId: null,
              outputCid: `gh:pr:${pr.number}`,
              role: 'judged_work',
              external: {
                kind: 'github_pr',
                pr: pr.number,
                url: pr.url,
                commit_sha: pr.headRefOid,
              },
            },
          ],
        },
        null,
        2,
      ),
    );
    return;
  }

  const agent = await connect({ configDir: agentDir });
  const task = await agent.tasks.create({
    taskType: ASSESS_BRIEF_TYPE,
    teamId,
    diaryId,
    input: input as unknown as Record<string, unknown>,
    references: [
      {
        taskId: null,
        outputCid: `gh:pr:${pr.number}`,
        role: 'judged_work',
        external: {
          kind: 'github_pr',
          pr: pr.number,
          url: pr.url,
          commit_sha: pr.headRefOid,
        },
      },
    ],
  });

  console.error(`[task] created ${task.id} (status=${task.status})`);
  console.log(JSON.stringify({ id: task.id, status: task.status }, null, 2));
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
