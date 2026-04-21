/**
 * resolve-issue.ts — thin shim over `@moltnet/agent-runtime`.
 *
 * Historically this file contained the full headless-pi prototype
 * (snapshot + VM + session wiring). That logic now lives in
 * `libs/agent-runtime/` and `libs/pi-extension/`. This shim preserves
 * the original CLI surface (`--issue`, `--agent`, `--model`) by
 * synthesizing a `fulfill_brief` Task from the given GitHub issue and
 * handing it to an in-process `FileTaskSource`-equivalent.
 *
 * Usage:
 *   pnpm --filter @moltnet/tools tsx src/resolve-issue.ts --issue 123
 *   pnpm --filter @moltnet/tools tsx src/resolve-issue.ts --issue 123 --agent legreffier --model claude-sonnet-4-5
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

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
  console.error('Usage: tsx src/resolve-issue.ts --issue <number|url>');
  process.exit(1);
}

const issueRef = args.issue;
const agentName = args.agent!;
const modelId = args.model!;
const provider = args.provider!;
const dryRun = args['dry-run']!;

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
  ) as { snapshot?: SandboxConfig['vfs'] } & SandboxConfig;

  // Resolve agentDir + creds so we can fetch the GH issue before booting.
  const mainRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const agentDir = join(mainRepo, '.moltnet', agentName);
  const envRaw = readFileSync(join(agentDir, 'env'), 'utf8');
  const envMatches = Object.fromEntries(
    envRaw
      .split('\n')
      .map((l) => l.match(/^([A-Z0-9_]+)="?([^"]*)"?$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
  const teamId = envMatches['MOLTNET_TEAM_ID'] ?? randomUUID();
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

  const runtime = new AgentRuntime({
    source: new SingleTaskSource(task),
    makeReporter: () => new StdoutReporter(),
    agentName,
    mountPath: cwd,
    provider,
    model: modelId,
    sandboxConfig,
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
