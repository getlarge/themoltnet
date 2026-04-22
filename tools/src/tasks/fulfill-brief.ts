/**
 * fulfill-brief.ts — GitHub-issue convenience shim over `@moltnet/agent-runtime`.
 *
 * What it does
 * ------------
 * Synthesizes a `fulfill_brief` Task from a GitHub issue and executes it
 * headlessly in a Gondolin VM via `createPiTaskExecutor`. The issue body +
 * recent comments become the brief; the task runs through the same
 * AgentRuntime + reporter path as any other `fulfill_brief` task.
 *
 * This is the same wire-format Task that the future API daemon will claim
 * from `POST /agent-runtimes/:id/tasks/claim`. The only difference here is
 * the source — we build the Task in-process from `gh issue view` instead of
 * pulling it from the server.
 *
 * Prerequisites
 * -------------
 * - `sandbox.json` present in the current working directory (defines the
 *   Gondolin snapshot + egress policy).
 * - `.moltnet/<agent>/` populated: `moltnet.json` credentials, `env` with
 *   at minimum `MOLTNET_TEAM_ID` (and optionally `MOLTNET_DIARY_ID`), and
 *   the SSH signing key used by the accountable-commit workflow.
 * - `gh` CLI on PATH. The script resolves a short-lived GitHub App token
 *   from the agent's `moltnet.json` (never falls back to human auth).
 * - Run from the **main worktree** (`/Users/.../themoltnet`), not a nested
 *   `.claude/worktrees/*` worktree — the VM mounts the tree at `/workspace`
 *   and nested-worktree `.git` pointer files can't resolve there.
 *
 * Usage
 * -----
 *   pnpm --filter @moltnet/tools resolve-issue --issue 123
 *   pnpm --filter @moltnet/tools resolve-issue --issue 123 \
 *     --agent legreffier --provider anthropic --model claude-sonnet-4-5
 *
 *   # Or directly, from any cwd with sandbox.json:
 *   pnpm exec tsx tools/src/tasks/fulfill-brief.ts --issue 123
 *
 *   # Inspect the synthesized Task without booting a VM:
 *   pnpm exec tsx tools/src/tasks/fulfill-brief.ts --issue 123 --dry-run
 *
 * Flags
 * -----
 *   -i, --issue     GitHub issue number or URL (required)
 *   -a, --agent     MoltNet agent name (default: legreffier). Must match
 *                   `.moltnet/<name>/` on disk; restricted to [A-Za-z0-9_-].
 *   -p, --provider  LLM provider (default: anthropic)
 *   -m, --model     Model id for that provider (default: claude-sonnet-4-5)
 *       --dry-run   Print the synthesized Task JSON and exit without
 *                   booting the VM.
 *
 * What runs inside the VM
 * -----------------------
 * The brief (built from issue body + last 5 comments) is handed to the
 * `fulfill_brief` prompt mapper, which instructs the agent to:
 *   1. Create a feature branch `fix/<issue>-<slug>`
 *   2. Understand + implement the change
 *   3. Follow the legreffier accountable-commit flow (signed diary entry
 *      per commit)
 *   4. Push the branch and open a PR referencing the issue
 *
 * Tool calls (read/write/edit/bash) execute inside the Gondolin VM via the
 * redirected ops in `libs/pi-extension/src/tool-operations.ts`. The MoltNet
 * diary/entry tools talk to the REST API through the egress proxy using the
 * agent's credentials. Final `TaskOutput` (status, usage, duration) is
 * printed on stdout.
 *
 * Exit codes
 * ----------
 *   0 — task completed successfully
 *   1 — task failed, cancelled, or runtime error (missing args, missing
 *       MOLTNET_TEAM_ID, gh token resolution failure, etc.)
 *
 * Related
 * -------
 *   tools/src/tasks/run-task.ts — execute any Task fixture (not GH-specific)
 *   libs/agent-runtime/        — runtime + reporters + task sources
 *   libs/pi-extension/runtime  — createPiTaskExecutor (VM wiring)
 *   libs/tasks/                — Task / FulfillBriefInput schemas
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

import {
  AgentRuntime,
  StdoutReporter,
  type TaskSource,
} from '@moltnet/agent-runtime';
import {
  FULFILL_BRIEF_TYPE,
  type FulfillBriefInput,
  type Task,
} from '@moltnet/tasks';
import type { SandboxConfig } from '@themoltnet/pi-extension';
import { createPiTaskExecutor } from '@themoltnet/pi-extension/runtime';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    issue: { type: 'string', short: 'i' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    model: { type: 'string', short: 'm', default: 'claude-sonnet-4-5' },
    provider: { type: 'string', short: 'p', default: 'anthropic' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args.issue) {
  console.error(
    'Usage: tsx tools/src/tasks/fulfill-brief.ts --issue <number|url>',
  );
  process.exit(1);
}

const issueRef = args.issue;
const agentName = args.agent!;
const modelId = args.model!;
const provider = args.provider!;
const dryRun = args['dry-run']!;

// The agent name is joined into filesystem paths below. Reject anything
// that could escape the `.moltnet/` directory via traversal or absolute
// segments. Matches the set of identifiers the onboarding flow emits.
if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  console.error(
    `Invalid --agent "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// GitHub helpers (host-side — the shim needs them before the VM boots)
// ---------------------------------------------------------------------------

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

interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
  comments: { body: string; author: { login: string } }[];
}

function fetchIssue(cwd: string, ghToken: string): GhIssue {
  const raw = execFileSync(
    'gh',
    ['issue', 'view', issueRef, '--json', 'number,title,body,labels,comments'],
    {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, GH_TOKEN: ghToken },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(raw) as GhIssue;
}

// ---------------------------------------------------------------------------
// Build the fulfill_brief Task from the GitHub issue
// ---------------------------------------------------------------------------

function buildBriefFromIssue(issue: GhIssue): FulfillBriefInput {
  const labelList = issue.labels.map((l) => l.name).join(', ');
  const recent = issue.comments
    .slice(-5)
    .map((c) => `**${c.author.login}**: ${c.body.slice(0, 300)}`)
    .join('\n\n');

  const brief = [
    `Resolve GitHub issue #${issue.number}: ${issue.title}`,
    '',
    labelList ? `Labels: ${labelList}` : '',
    '',
    '## Description',
    '',
    issue.body || '_No description provided._',
    recent ? `\n## Recent comments\n\n${recent}` : '',
    '',
    '## Workflow',
    '',
    `1. Create a feature branch: \`git checkout -b fix/${issue.number}-<slug>\``,
    '2. Understand the problem — read relevant code, reproduce if possible',
    '3. Implement the fix or feature',
    '4. Write tests if applicable',
    '5. Follow the legreffier accountable commit workflow (diary entry + signed commit)',
    `6. Push the branch and create a PR referencing issue #${issue.number}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    brief,
    title: issue.title,
    scope_hint: 'misc',
  };
}

function buildFulfillBriefTask(
  issue: GhIssue,
  teamId: string,
  diaryId: string | null,
): Task {
  const input = buildBriefFromIssue(issue);
  return {
    id: randomUUID(),
    task_type: FULFILL_BRIEF_TYPE,
    team_id: teamId,
    diary_id: diaryId,
    output_kind: 'artifact',
    input: input as unknown as Record<string, unknown>,
    // PR 0 does not persist tasks — these CIDs are placeholders. PR 1 will
    // compute them from the actual canonical JSON bytes.
    input_schema_cid: 'cid-placeholder-input-schema',
    input_cid: 'cid-placeholder-input',
    criteria_cid: null,
    references: [
      {
        task_id: null,
        output_cid: `gh:issue:${issue.number}`,
        role: 'context',
        external: {
          kind: 'github_issue',
          issue: issue.number,
        },
      },
    ],
    correlation_id: null,
    imposed_by_agent_id: null,
    imposed_by_human_id: null,
    accepted_attempt_n: null,
    status: 'running',
    queued_at: new Date().toISOString(),
    completed_at: null,
    expires_at: null,
    cancelled_by_agent_id: null,
    cancelled_by_human_id: null,
    cancel_reason: null,
    max_attempts: 1,
  };
}

// ---------------------------------------------------------------------------
// Ad-hoc in-memory TaskSource: yields one task, then exhausts.
// ---------------------------------------------------------------------------

class SingleTaskSource implements TaskSource {
  private yielded = false;
  constructor(private readonly task: Task) {}
  async claim(): Promise<Task | null> {
    if (this.yielded) return null;
    this.yielded = true;
    return this.task;
  }
  async close(): Promise<void> {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cwd = process.cwd();
  const sandboxConfig = JSON.parse(
    readFileSync(join(cwd, 'sandbox.json'), 'utf8'),
  ) as SandboxConfig;

  // Resolve agentDir + creds so we can fetch the GH issue before booting.
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
        'Refusing to synthesize a Task with a random team id — the downstream ' +
        'DB / Keto would reject it. Set MOLTNET_TEAM_ID or run the agent ' +
        'onboarding flow to populate the env file.',
    );
  }
  const diaryId = envMatches['MOLTNET_DIARY_ID'] ?? null;

  console.log(`[issue] Fetching #${issueRef}...`);
  const ghToken = getAgentGhToken(agentDir);
  const issue = fetchIssue(cwd, ghToken);
  console.log(`[issue] #${issue.number}: ${issue.title}`);

  const task = buildFulfillBriefTask(issue, teamId, diaryId);

  if (dryRun) {
    console.log('\n[dry-run] Synthesized Task:');
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  const executeTask = createPiTaskExecutor({
    agentName,
    mountPath: cwd,
    provider,
    model: modelId,
    sandboxConfig,
  });

  const runtime = new AgentRuntime({
    source: new SingleTaskSource(task),
    makeReporter: () => new StdoutReporter(),
    executeTask,
  });

  const outputs = await runtime.start();
  const [output] = outputs;
  if (!output) {
    console.error('[fatal] Runtime produced no outputs');
    process.exit(1);
  }

  console.log('\n[done] TaskOutput:');
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== 'completed') process.exit(1);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
