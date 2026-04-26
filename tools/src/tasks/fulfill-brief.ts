/**
 * fulfill-brief.ts — synthesize a `fulfill_brief` task from a GitHub issue
 * and POST it to the Tasks API. Execution happens later, in the daemon.
 *
 * What it does
 * ------------
 * Reads `gh issue view <ref>` (using the agent's GitHub App token), turns
 * the issue body + recent comments into a `FulfillBriefInput`, and calls
 * `agent.tasks.create(...)`. Prints the new task id and a console URL on
 * stdout. The created task lands in the queue with status `queued`; any
 * daemon polling for `fulfill_brief` will claim it.
 *
 * Prerequisites
 * -------------
 * - `.moltnet/<agent>/` populated with `moltnet.json` and `env`
 *   (at minimum `MOLTNET_TEAM_ID`)
 * - `gh` CLI on PATH
 *
 * Usage
 * -----
 *   pnpm --filter @moltnet/tools task:fulfill-brief --issue 123
 *   pnpm --filter @moltnet/tools task:fulfill-brief --issue 123 --dry-run
 *
 * Flags
 * -----
 *   -i, --issue     GitHub issue number or URL (required)
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
  FULFILL_BRIEF_TYPE,
  type FulfillBriefInput,
} from '@themoltnet/agent-runtime';
import { connect } from '@themoltnet/sdk';

const { values: args } = parseArgs({
  options: {
    issue: { type: 'string', short: 'i' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args.issue) {
  console.error(
    'Usage: tsx tools/src/tasks/fulfill-brief.ts --issue <number|url> [--agent <name>] [--dry-run]',
  );
  process.exit(1);
}

const issueRef = args.issue;
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
    scopeHint: 'misc',
  };
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
        'MOLTNET_DIARY_ID to the diary that should own this brief.',
    );
  }

  console.error(`[issue] Fetching #${issueRef}...`);
  const ghToken = getAgentGhToken(agentDir);
  const issue = fetchIssue(cwd, ghToken);
  console.error(`[issue] #${issue.number}: ${issue.title}`);

  const input = buildBriefFromIssue(issue);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          taskType: FULFILL_BRIEF_TYPE,
          teamId,
          diaryId,
          input,
        },
        null,
        2,
      ),
    );
    return;
  }

  const agent = await connect({ configDir: agentDir });
  const task = await agent.tasks.create({
    taskType: FULFILL_BRIEF_TYPE,
    teamId,
    diaryId,
    input: input as unknown as Record<string, unknown>,
    references: [
      {
        taskId: null,
        outputCid: `gh:issue:${issue.number}`,
        role: 'context',
        external: {
          kind: 'github_issue',
          issue: issue.number,
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
