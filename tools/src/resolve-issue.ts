/**
 * resolve-issue.ts — Headless pi agent that picks up a GitHub issue,
 * works in a Gondolin sandbox, and produces a PR with accountable commits.
 *
 * This is a research prototype for the MoltNet task model (#852).
 * It combines:
 *   - pi SDK for headless agent sessions (no TUI)
 *   - Gondolin VM for sandboxed tool execution
 *   - MoltNet identity + diary for accountability
 *   - Legreffier skill for commit signing workflow
 *
 * Usage:
 *   pnpm --filter @moltnet/tools tsx src/resolve-issue.ts --issue 123
 *   pnpm --filter @moltnet/tools tsx src/resolve-issue.ts --issue 123 --agent legreffier --model claude-sonnet-4-5
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { getModel } from '@mariozechner/pi-ai';
import {
  createAgentSession,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  SessionManager,
} from '@mariozechner/pi-coding-agent';
import {
  activateAgentEnv,
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinReadOps,
  createGondolinWriteOps,
  createMoltNetTools,
  ensureSnapshot,
  findMainWorktree,
  resumeVm,
  type SandboxConfig,
} from '@themoltnet/pi-extension';
import { connect } from '@themoltnet/sdk';

// ---------------------------------------------------------------------------
// Sandbox config (loaded from sandbox.json)
// ---------------------------------------------------------------------------

function loadSandboxConfig(cwd: string): SandboxConfig {
  const configPath = join(cwd, 'sandbox.json');
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

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
// Helpers
// ---------------------------------------------------------------------------

function getAgentGhToken(agentDir: string): string | null {
  try {
    const credsPath = join(agentDir, 'moltnet.json');
    return execFileSync(
      'npx',
      ['@themoltnet/cli', 'github', 'token', '--credentials', credsPath],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    return null;
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
  const ghArgs = [
    'issue',
    'view',
    issueRef,
    '--json',
    'number,title,body,labels,comments',
  ];
  const raw = execFileSync('gh', ghArgs, {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, GH_TOKEN: ghToken },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(raw);
}

function buildTaskPrompt(issue: GhIssue, diaryId: string): string {
  const labelList = issue.labels.map((l) => l.name).join(', ');
  const commentSummary = issue.comments
    .slice(-5)
    .map((c) => `**${c.author.login}**: ${c.body.slice(0, 300)}`)
    .join('\n\n');

  return [
    '# Resolve Issue Agent',
    '',
    'You are a software engineering agent working in a sandboxed environment.',
    'Your workspace is at /workspace (mounted from the host repository).',
    '',
    '## IMPORTANT: Read the legreffier skill FIRST',
    '',
    'Before doing anything, read `/workspace/.agents/skills/legreffier/SKILL.md`.',
    'Follow its accountable commit workflow for EVERY commit in this session.',
    'Every commit must have a diary entry. Use `moltnet_create_entry` for diary entries.',
    `Your diary ID is: ${diaryId}`,
    '',
    `## Task: Resolve Issue #${issue.number}`,
    '',
    `**Title:** ${issue.title}`,
    labelList ? `**Labels:** ${labelList}` : '',
    '',
    '### Issue Description',
    '',
    issue.body ?? '_No description provided._',
    '',
    commentSummary ? `### Recent Comments\n\n${commentSummary}` : '',
    '',
    '### Workflow',
    '',
    `1. Create a feature branch: \`git checkout -b fix/${issue.number}-<slug>\``,
    '2. Understand the problem — read relevant code, reproduce if possible',
    '3. Implement the fix or feature',
    '4. Write tests if applicable',
    '5. Follow the legreffier accountable commit workflow (diary entry + signed commit)',
    `6. Push the branch and create a PR referencing issue #${issue.number}`,
    '7. When done, output a summary of what was done',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cwd = process.cwd();

  // 1. Boot sandbox
  console.log('[sandbox] Ensuring snapshot...');
  const sandboxConfig = loadSandboxConfig(cwd);
  const checkpointPath = await ensureSnapshot({
    config: sandboxConfig.snapshot,
    onProgress: (msg) => console.log(`[sandbox] ${msg}`),
  });

  console.log('[sandbox] Resuming VM...');
  const managed = await resumeVm({
    checkpointPath,
    agentName,
    mountPath: cwd,
    sandboxConfig,
  });

  // 2. Activate agent env on host
  const mainRepo = findMainWorktree();
  activateAgentEnv(managed.credentials.agentEnv, mainRepo);
  const agentDir = managed.agentDir;
  const diaryId = managed.credentials.agentEnv.MOLTNET_DIARY_ID ?? '';

  console.log(`[agent] Name: ${agentName}`);
  console.log(`[agent] Diary: ${diaryId}`);

  // 3. Fetch issue
  console.log(`[issue] Fetching #${issueRef}...`);
  const ghToken = getAgentGhToken(agentDir);
  if (!ghToken) {
    throw new Error(
      `Failed to resolve agent GH token from ${agentDir}/moltnet.json. ` +
        'Refusing to fall back to human auth context.',
    );
  }
  const issue = fetchIssue(cwd, ghToken);
  console.log(`[issue] #${issue.number}: ${issue.title}`);

  if (dryRun) {
    console.log('\n[dry-run] System prompt:');
    console.log(buildTaskPrompt(issue, diaryId));
    console.log('\n[dry-run] Would create headless agent session. Exiting.');
    await managed.vm.close();
    return;
  }

  // 4. Create sandboxed tools
  const gondolinRead = createReadTool(cwd, {
    operations: createGondolinReadOps(managed.vm, cwd),
  });
  const gondolinWrite = createWriteTool(cwd, {
    operations: createGondolinWriteOps(managed.vm, cwd),
  });
  const gondolinEdit = createEditTool(cwd, {
    operations: createGondolinEditOps(managed.vm, cwd),
  });
  const gondolinBash = createBashTool(cwd, {
    operations: createGondolinBashOps(managed.vm, cwd),
  });

  // 5. Create MoltNet diary tools (run on host)
  const moltnetAgent = await connect({ configDir: agentDir });
  const moltnetTools = createMoltNetTools({
    getAgent: () => moltnetAgent,
    getDiaryId: () => diaryId,
  });

  // 6. Create headless pi agent session
  const piAuthDir = join(homedir(), '.pi', 'agent');
  // Provider/model IDs are user-supplied strings; cast through the strict overload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (getModel as any)(provider, modelId);
  console.log(`[session] Model: ${provider}/${modelId}`);

  const { session } = await createAgentSession({
    agentDir: piAuthDir,
    model,
    tools: [gondolinRead, gondolinWrite, gondolinEdit, gondolinBash],
    customTools: moltnetTools,
    sessionManager: SessionManager.inMemory(),
  });

  console.log(`[session] Tools: ${session.getActiveToolNames().join(', ')}`);

  // 7. Subscribe to events for streaming output
  session.subscribe((event) => {
    if (event.type === 'message_update') {
      const ae = event.assistantMessageEvent;
      if (ae.type === 'text_delta') {
        process.stdout.write(ae.delta);
      }
    } else if (event.type === 'tool_execution_start') {
      console.log(`\n[tool] ${event.toolName}...`);
    } else if (event.type === 'tool_execution_end') {
      if (event.isError) {
        console.error(
          `[tool:error] ${event.toolName}: ${JSON.stringify(event.result)}`,
        );
      }
    } else if (event.type === 'turn_end') {
      const msg = (event as Record<string, unknown>).message as
        | { stopReason?: string }
        | undefined;
      if (msg?.stopReason === 'error') {
        console.error('\n[ERROR] LLM API error. Aborting.');
        process.exit(1);
      }
    }
  });

  // 8. Run the agent — task prompt includes legreffier skill loading
  const taskPrompt = buildTaskPrompt(issue, diaryId);
  console.log(`\n[agent] Starting work on issue #${issue.number}...\n`);
  await session.prompt(taskPrompt);

  console.log('\n\n[done] Agent finished.');
  session.dispose();
  await managed.vm.close();
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
