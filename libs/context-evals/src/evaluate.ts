/**
 * evaluate.ts — Worktree-based task evaluator for gpack
 *
 * Runs a coding task inside a git worktree, injects a context pack, and scores
 * the result by running FAIL_TO_PASS tests. Extracted from run-eval.ts so that
 * the gpack optimization loop can call it as a black-box function.
 */

import {
  access,
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { createClaudeQuery } from './anthropic.js';
import {
  type CommandResult,
  execFileText,
  runShellCommand,
} from './process.js';
import type { AssistantPayload, ResultPayload } from './sdk-types.js';

export interface GpackTask {
  id: string;
  baseCommit: string;
  problemStatement: string;
  failToPass: string[];
  passToPass: string[];
  setup?: string[];
}

export interface EvalTrace {
  taskId: string;
  worktreeDir?: string;
  taskPrompt: string;
  executor: 'anthropic-sdk';
  setupOutputs: Array<{ cmd: string; passed: boolean; output: string }>;
  preTaskTestOutputs: Array<{ cmd: string; passed: boolean; output: string }>;
  evalResult: string;
  taskStepPassed: boolean;
  taskStepOutput: string;
  sessionId?: string;
  turnCount?: number;
  taskDurationMs?: number;
  taskApiDurationMs?: number;
  taskCostUsd?: number;
  taskUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  toolCallCount?: number;
  toolSummaries?: string[];
  permissionDenials?: Array<{ toolName: string; toolUseId: string }>;
  gitStatus: string;
  gitDiffStat: string;
  testsPassed: boolean;
  testOutputs: Array<{ cmd: string; passed: boolean; output: string }>;
  regressionOutputs: Array<{ cmd: string; passed: boolean; output: string }>;
}

export interface EvalResult {
  score: number;
  trace: EvalTrace;
}

interface TaskStepResult {
  passed: boolean;
  output: string;
  stderrOutput?: string;
  sessionId?: string;
  turnCount?: number;
  durationMs?: number;
  apiDurationMs?: number;
  costUsd?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  toolCallCount?: number;
  toolSummaries?: string[];
  permissionDenials?: Array<{ toolName: string; toolUseId: string }>;
}

const TELEMETRY_HIDDEN_PATHS = new Set([
  'eval-task.md',
  'eval-criteria.json',
  'eval-result.md',
  'pnpm-lock.yaml',
]);

function isTelemetryHiddenPath(path: string): boolean {
  return (
    TELEMETRY_HIDDEN_PATHS.has(path) ||
    path === '.legreffier/context' ||
    path.startsWith('.legreffier/context/')
  );
}

function filterStatusOutput(output: string): string {
  return output
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      const path = trimmed.slice(3).trim();
      return !isTelemetryHiddenPath(path);
    })
    .join('\n')
    .trim();
}

function filterDiffStatOutput(output: string): string {
  return output
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      const pipeIndex = line.indexOf('|');
      if (pipeIndex === -1) return true;
      const path = line.slice(0, pipeIndex).trim();
      return !isTelemetryHiddenPath(path);
    })
    .join('\n')
    .trim();
}

const activeWorktrees: string[] = [];
let sigintRegistered = false;

/**
 * Register a SIGINT handler that cleans up active worktrees on Ctrl-C.
 * Called lazily from createWorktree() so importing this module has no
 * side effects. Idempotent — only registers once.
 */
function ensureSigintHandler(): void {
  if (sigintRegistered) return;
  sigintRegistered = true;
  process.on('SIGINT', () => {
    void cleanupAllWorktrees().finally(() => process.exit(1));
  });
}

export async function createWorktree(
  baseCommit: string,
  label: string,
): Promise<string> {
  ensureSigintHandler();
  const tmpDir = await mkdtemp(resolve(tmpdir(), 'gpack-'));
  const worktreeDir = `${tmpDir}/gpack-${label}`;
  activeWorktrees.push(worktreeDir);
  await execFileText('git', ['worktree', 'add', worktreeDir, baseCommit]);
  return worktreeDir;
}

export async function removeWorktree(worktreeDir: string): Promise<void> {
  try {
    const list = await execFileText('git', ['worktree', 'list']);
    if (list.includes(worktreeDir)) {
      await execFileText('git', ['worktree', 'remove', '--force', worktreeDir]);
    } else {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  } catch {
    // best-effort
  }
  const idx = activeWorktrees.indexOf(worktreeDir);
  if (idx !== -1) activeWorktrees.splice(idx, 1);
}

export async function cleanupAllWorktrees(): Promise<void> {
  await Promise.all([...activeWorktrees].map((p) => removeWorktree(p)));
}

async function runAnthropicSdk(
  cwd: string,
  prompt: string,
  options: { model?: string } = {},
): Promise<TaskStepResult> {
  let stderrOutput = '';
  let sessionId: string | undefined;
  let finalResult: ResultPayload | null = null;
  let lastAssistantText = '';
  let toolCallCount = 0;
  const toolSummaries: string[] = [];

  const q = await createClaudeQuery({
    cwd,
    prompt,
    model: options.model,
    maxTurns: 20,
    clientApp: '@moltnet/tools:gpack',
    stderr: (data: string) => {
      stderrOutput += data;
    },
  });

  try {
    for await (const message of q as AsyncIterable<SDKMessage>) {
      sessionId ??= message.session_id;

      if (message.type === 'assistant') {
        const payload = message as unknown as AssistantPayload;
        const textBlocks = payload.message.content.filter(
          (b): b is { type: 'text'; text: string } =>
            b.type === 'text' && typeof b.text === 'string',
        );
        if (textBlocks.length > 0) {
          lastAssistantText = textBlocks.map((b) => b.text).join('\n');
        }
        // Count tool_use blocks in assistant messages for accurate tool call tracking
        toolCallCount += payload.message.content.filter(
          (b) => b.type === 'tool_use',
        ).length;
      } else if (message.type === 'tool_use_summary') {
        toolSummaries.push(message.summary);
      } else if (message.type === 'result') {
        finalResult = message as unknown as ResultPayload;
      }
    }
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : 'Anthropic SDK execution failed';
    q.close();
    return {
      passed: false,
      output: stderrOutput ? `${msg}\n\n${stderrOutput.trim()}` : msg,
      stderrOutput: stderrOutput || undefined,
      sessionId,
      toolCallCount,
      toolSummaries,
    };
  }

  q.close();

  if (!finalResult) {
    return {
      passed: false,
      output: stderrOutput
        ? `${lastAssistantText || 'No result from Anthropic SDK'}\n\n${stderrOutput.trim()}`
        : lastAssistantText || 'No result from Anthropic SDK',
      stderrOutput: stderrOutput || undefined,
      sessionId,
      toolCallCount,
      toolSummaries,
    };
  }

  return {
    passed: finalResult.subtype === 'success' && !finalResult.is_error,
    output:
      finalResult.subtype === 'success'
        ? (finalResult.result ?? lastAssistantText)
        : finalResult.errors?.join('\n') || lastAssistantText,
    stderrOutput: stderrOutput || undefined,
    sessionId,
    turnCount: finalResult.num_turns,
    durationMs: finalResult.duration_ms,
    apiDurationMs: finalResult.duration_api_ms,
    costUsd: finalResult.total_cost_usd,
    usage: {
      inputTokens: finalResult.usage?.input_tokens ?? 0,
      outputTokens: finalResult.usage?.output_tokens ?? 0,
      cacheCreationInputTokens: finalResult.usage?.cache_creation_input_tokens,
      cacheReadInputTokens: finalResult.usage?.cache_read_input_tokens,
    },
    toolCallCount,
    toolSummaries,
    permissionDenials: (finalResult.permission_denials ?? []).map((d) => ({
      toolName: d.tool_name,
      toolUseId: d.tool_use_id,
    })),
  };
}

export async function injectPack(
  worktreeDir: string,
  packContent: string,
): Promise<void> {
  const contextDir = `${worktreeDir}/.legreffier/context`;
  await mkdir(contextDir, { recursive: true });
  await writeFile(`${contextDir}/session-pack.md`, packContent, 'utf8');
}

async function ignoreEvalArtifacts(worktreeDir: string): Promise<void> {
  const gitDir = (
    await execFileText('git', ['rev-parse', '--git-dir'], { cwd: worktreeDir })
  ).trim();
  const infoDir = resolve(worktreeDir, gitDir, 'info');
  const infoExcludePath = resolve(infoDir, 'exclude');
  await mkdir(infoDir, { recursive: true });
  await appendFile(
    infoExcludePath,
    '\n# gpack eval artifacts\neval-task.md\neval-criteria.json\neval-result.md\n.legreffier/context/\n',
    'utf8',
  );
}

function normalizeSetupCommand(cmd: string): string {
  if (!cmd.startsWith('pnpm install')) return cmd;
  const withoutFrozen = cmd.replace(/\s+--frozen-lockfile\b/g, '').trim();
  return withoutFrozen.includes('--ignore-scripts')
    ? withoutFrozen
    : `${withoutFrozen} --ignore-scripts`;
}

async function runCommand(
  cmd: string,
  cwd: string,
  timeoutMs = 300_000,
): Promise<CommandResult> {
  return runShellCommand(cmd, cwd, timeoutMs);
}

async function captureGitState(
  cwd: string,
): Promise<{ status: string; diffStat: string }> {
  const [status, diffStat] = await Promise.all([
    runCommand('git status --short', cwd, 60_000),
    runCommand('git diff --stat', cwd, 60_000),
  ]);

  return {
    status: filterStatusOutput(status.output),
    diffStat: filterDiffStatOutput(diffStat.output),
  };
}

async function listChangedFiles(cwd: string): Promise<string[]> {
  const diff = await runCommand('git diff --name-only', cwd, 60_000);
  if (!diff.passed && !diff.output) return [];
  return diff.output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function requiresDependencyRefresh(changedFiles: string[]): boolean {
  return changedFiles.some(
    (file) =>
      file === 'pnpm-workspace.yaml' ||
      file === 'pnpm-lock.yaml' ||
      file.endsWith('/package.json') ||
      file === 'package.json',
  );
}

export async function evaluateTask(
  task: GpackTask,
  packContent: string,
  options: {
    taskPromptSuffix?: string;
    verbose?: boolean;
    claudeModel?: string;
  } = {},
): Promise<EvalResult> {
  const worktreeDir = await createWorktree(task.baseCommit, task.id);
  let preserveWorktree = false;

  try {
    await ignoreEvalArtifacts(worktreeDir);

    const setupOutputs: Array<{
      cmd: string;
      passed: boolean;
      output: string;
    }> = [];

    for (const originalCmd of task.setup ?? []) {
      const cmd = normalizeSetupCommand(originalCmd);
      if (options.verbose) console.log(`  [setup] ${cmd}`);
      const setup = await runCommand(cmd, worktreeDir, 900_000);
      setupOutputs.push({ cmd, ...setup });
      if (!setup.passed) {
        return {
          score: 0,
          trace: {
            taskId: task.id,
            worktreeDir,
            taskPrompt: task.problemStatement,
            executor: 'anthropic-sdk',
            setupOutputs,
            preTaskTestOutputs: [],
            evalResult: `Setup failed for command: ${cmd}\n${setup.output.slice(0, 3000)}`,
            taskStepPassed: false,
            taskStepOutput: '',
            gitStatus: '',
            gitDiffStat: '',
            testsPassed: false,
            testOutputs: [],
            regressionOutputs: [],
          },
        };
      }
    }

    await writeFile(
      `${worktreeDir}/eval-task.md`,
      task.problemStatement,
      'utf8',
    );

    const preTaskTestOutputs = await Promise.all(
      task.failToPass.map(async (cmd) => ({
        cmd,
        ...(await runCommand(cmd, worktreeDir)),
      })),
    );

    if (packContent.trim()) {
      await injectPack(worktreeDir, packContent);
    }

    const taskPrompt =
      `Complete the task described in eval-task.md in the current directory.` +
      ` If .legreffier/context/session-pack.md exists, read it first as repo context.` +
      (options.taskPromptSuffix ? ` ${options.taskPromptSuffix}` : '');
    if (options.verbose) console.log('  [task] running anthropic-sdk...');

    const resolvedTaskStep = await runAnthropicSdk(worktreeDir, taskPrompt, {
      model: options.claudeModel,
    });
    preserveWorktree = !resolvedTaskStep.passed;

    const changedFiles = await listChangedFiles(worktreeDir);
    if (requiresDependencyRefresh(changedFiles)) {
      const refreshCmd = 'pnpm install --ignore-scripts';
      if (options.verbose) console.log(`  [setup] ${refreshCmd} (post-task)`);
      const refresh = await runCommand(refreshCmd, worktreeDir, 900_000);
      setupOutputs.push({
        cmd: `${refreshCmd} # post-task-refresh`,
        ...refresh,
      });
      if (!refresh.passed) {
        return {
          score: 0,
          trace: {
            taskId: task.id,
            worktreeDir,
            taskPrompt: task.problemStatement,
            executor: 'anthropic-sdk',
            setupOutputs,
            preTaskTestOutputs,
            evalResult: `Post-task dependency refresh failed\n${refresh.output.slice(0, 3000)}`,
            taskStepPassed: resolvedTaskStep.passed,
            taskStepOutput: resolvedTaskStep.output,
            sessionId: resolvedTaskStep.sessionId,
            turnCount: resolvedTaskStep.turnCount,
            taskDurationMs: resolvedTaskStep.durationMs,
            taskApiDurationMs: resolvedTaskStep.apiDurationMs,
            taskCostUsd: resolvedTaskStep.costUsd,
            taskUsage: resolvedTaskStep.usage,
            toolCallCount: resolvedTaskStep.toolCallCount,
            toolSummaries: resolvedTaskStep.toolSummaries,
            permissionDenials: resolvedTaskStep.permissionDenials,
            gitStatus: '',
            gitDiffStat: '',
            testsPassed: false,
            testOutputs: [],
            regressionOutputs: [],
          },
        };
      }
    }

    const gitState = await captureGitState(worktreeDir);

    const testOutputs = await Promise.all(
      task.failToPass.map(async (cmd) => ({
        cmd,
        ...(await runCommand(cmd, worktreeDir)),
      })),
    );

    const regressionOutputs = await Promise.all(
      task.passToPass.map(async (cmd) => ({
        cmd,
        ...(await runCommand(cmd, worktreeDir)),
      })),
    );

    const allFTPPassed = testOutputs.every((t) => t.passed);
    const allPTPPassed = regressionOutputs.every((t) => t.passed);
    const testsPassed = allFTPPassed && allPTPPassed;

    let evalResult = '';
    const repoRoot = (
      await execFileText('git', ['rev-parse', '--show-toplevel'], {
        cwd: worktreeDir,
      })
    ).trim();
    const evalCriteriaPath = resolve(
      repoRoot,
      'evals',
      task.id,
      'criteria.json',
    );
    try {
      await access(evalCriteriaPath);
      await copyFile(evalCriteriaPath, `${worktreeDir}/eval-criteria.json`);
      const evalPrompt =
        `Evaluate the solution against the criteria in eval-criteria.json.` +
        ` For each criterion: state pass/fail, score (0 to max_score), one sentence evidence.` +
        ` Write results to eval-result.md`;
      const evalStep = await runAnthropicSdk(worktreeDir, evalPrompt, {
        model: options.claudeModel,
      });
      const resultPath = `${worktreeDir}/eval-result.md`;
      try {
        await access(resultPath);
        evalResult = await readFile(resultPath, 'utf8');
      } catch {
        if (!evalStep.passed) {
          evalResult = 'Eval step failed to produce eval-result.md';
        }
      }
    } catch {
      // criteria file not present
    }

    const ftpScore =
      task.failToPass.length === 0
        ? 1
        : testOutputs.filter((t) => t.passed).length / task.failToPass.length;
    const score = allPTPPassed ? ftpScore : Math.min(ftpScore, 0.5);

    if (options.verbose) {
      console.log(
        `  [eval] task=${task.id} score=${score.toFixed(2)} ftp=${allFTPPassed} ptp=${allPTPPassed}`,
      );
    }

    return {
      score,
      trace: {
        taskId: task.id,
        worktreeDir,
        taskPrompt: task.problemStatement,
        executor: 'anthropic-sdk',
        setupOutputs,
        preTaskTestOutputs,
        evalResult,
        taskStepPassed: resolvedTaskStep.passed,
        taskStepOutput: resolvedTaskStep.output,
        sessionId: resolvedTaskStep.sessionId,
        turnCount: resolvedTaskStep.turnCount,
        taskDurationMs: resolvedTaskStep.durationMs,
        taskApiDurationMs: resolvedTaskStep.apiDurationMs,
        taskCostUsd: resolvedTaskStep.costUsd,
        taskUsage: resolvedTaskStep.usage,
        toolCallCount: resolvedTaskStep.toolCallCount,
        toolSummaries: resolvedTaskStep.toolSummaries,
        permissionDenials: resolvedTaskStep.permissionDenials,
        gitStatus: gitState.status,
        gitDiffStat: gitState.diffStat,
        testsPassed,
        testOutputs,
        regressionOutputs,
      },
    };
  } finally {
    if (!preserveWorktree) {
      await removeWorktree(worktreeDir);
    }
  }
}
