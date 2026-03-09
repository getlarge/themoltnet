/**
 * evaluate.ts — Worktree-based task evaluator for gpack
 *
 * Runs a coding task inside a git worktree, injects a context pack, and scores
 * the result by running FAIL_TO_PASS tests. Extracted from run-eval.ts so that
 * the gpack optimization loop can call it as a black-box function.
 */

import { execFileSync, execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GpackTask {
  /** Unique identifier (e.g. PR number or commit hash) */
  id: string;
  /** Commit hash to check out as the task baseline */
  baseCommit: string;
  /** Human-readable problem statement injected as eval-task.md */
  problemStatement: string;
  /** Shell commands that must exit 0 for the task to be considered solved */
  failToPass: string[];
  /** Shell commands that must continue to exit 0 (regression check) */
  passToPass: string[];
  /** Setup commands to run after checkout (e.g. pnpm install) */
  setup?: string[];
}

export interface EvalTrace {
  taskId: string;
  /** Exact task instructions loaded from task.md */
  taskPrompt: string;
  /** Raw stdout/stderr from setup commands */
  setupOutputs: Array<{ cmd: string; passed: boolean; output: string }>;
  /** Validation commands run before Claude edits anything */
  preTaskTestOutputs: Array<{ cmd: string; passed: boolean; output: string }>;
  /** Content of eval-result.md written by the eval Claude session */
  evalResult: string;
  /** Whether the task Claude step exited successfully */
  taskStepPassed: boolean;
  /** git status after the Claude task step */
  gitStatus: string;
  /** git diff summary after the Claude task step */
  gitDiffStat: string;
  /** Whether all FAIL_TO_PASS commands exited 0 */
  testsPassed: boolean;
  /** Raw stdout/stderr from each FAIL_TO_PASS command */
  testOutputs: Array<{ cmd: string; passed: boolean; output: string }>;
  /** Raw stdout/stderr from each PASS_TO_PASS command */
  regressionOutputs: Array<{ cmd: string; passed: boolean; output: string }>;
}

export interface EvalResult {
  score: number; // 0.0 – 1.0
  trace: EvalTrace;
}

// ── Worktree helpers ──────────────────────────────────────────────────────────

const activeWorktrees: string[] = [];

export function createWorktree(baseCommit: string, label: string): string {
  const tmpDir = execSync('mktemp -d', { encoding: 'utf8' }).trim();
  const worktreeDir = `${tmpDir}/gpack-${label}`;
  activeWorktrees.push(worktreeDir);
  execSync(`git worktree add "${worktreeDir}" "${baseCommit}"`, {
    stdio: 'pipe',
  });
  return worktreeDir;
}

export function removeWorktree(worktreeDir: string): void {
  try {
    const list = execSync('git worktree list', { encoding: 'utf8' });
    if (list.includes(worktreeDir)) {
      execSync(`git worktree remove --force "${worktreeDir}"`, {
        stdio: 'pipe',
      });
    } else {
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  } catch {
    // best-effort
  }
  const idx = activeWorktrees.indexOf(worktreeDir);
  if (idx !== -1) activeWorktrees.splice(idx, 1);
}

export function cleanupAllWorktrees(): void {
  for (const p of [...activeWorktrees]) {
    removeWorktree(p);
  }
}

process.on('exit', cleanupAllWorktrees);
process.on('SIGINT', () => process.exit(1));

// ── Claude runner ─────────────────────────────────────────────────────────────

function runClaude(
  cwd: string,
  prompt: string,
  flags: string[] = [],
): { passed: boolean; output: string } {
  const env = { ...process.env, CLAUDECODE: undefined };
  try {
    const output = execFileSync('claude', [...flags, prompt], {
      cwd,
      stdio: 'pipe',
      env,
      encoding: 'utf8',
      timeout: 900_000,
    });
    return { passed: true, output };
  } catch {
    return { passed: false, output: '' };
  }
}

// ── Context injection ─────────────────────────────────────────────────────────

export function injectPack(worktreeDir: string, packContent: string): void {
  const contextDir = `${worktreeDir}/.legreffier/context`;
  mkdirSync(contextDir, { recursive: true });
  writeFileSync(`${contextDir}/session-pack.md`, packContent, 'utf8');
}

// ── Test runner ───────────────────────────────────────────────────────────────

function runCommand(
  cmd: string,
  cwd: string,
  timeoutMs = 300_000,
): { passed: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: timeoutMs,
    });
    return { passed: true, output };
  } catch (err: any) {
    return {
      passed: false,
      output: (err.stdout ?? '') + (err.stderr ?? ''),
    };
  }
}

function captureGitState(cwd: string): { status: string; diffStat: string } {
  const status = runCommand('git status --short', cwd, 60_000);
  const diffStat = runCommand('git diff --stat', cwd, 60_000);

  return {
    status: status.output,
    diffStat: diffStat.output,
  };
}

// ── Main evaluator ────────────────────────────────────────────────────────────

/**
 * Run a single task evaluation in a fresh git worktree.
 *
 * 1. Checkout worktree at task.baseCommit
 * 2. Run setup commands
 * 3. Inject packContent into .legreffier/context/session-pack.md
 * 4. Copy task files and run Claude (task step)
 * 5. Run Claude eval step (--print)
 * 6. Run FAIL_TO_PASS + PASS_TO_PASS tests
 * 7. Score: fraction of FAIL_TO_PASS commands that passed
 */
export async function evaluateTask(
  task: GpackTask,
  packContent: string,
  options: {
    taskPromptSuffix?: string;
    verbose?: boolean;
    claudeModel?: string;
  } = {},
): Promise<EvalResult> {
  const worktreeDir = createWorktree(task.baseCommit, task.id);

  try {
    const setupOutputs: Array<{
      cmd: string;
      passed: boolean;
      output: string;
    }> = [];

    // Setup
    for (const cmd of task.setup ?? []) {
      if (options.verbose) console.log(`  [setup] ${cmd}`);
      const setup = runCommand(cmd, worktreeDir, 900_000);
      setupOutputs.push({ cmd, ...setup });
      if (!setup.passed) {
        return {
          score: 0,
          trace: {
            taskId: task.id,
            taskPrompt: task.problemStatement,
            setupOutputs,
            preTaskTestOutputs: [],
            evalResult: `Setup failed for command: ${cmd}\n${setup.output.slice(0, 3000)}`,
            taskStepPassed: false,
            gitStatus: '',
            gitDiffStat: '',
            testsPassed: false,
            testOutputs: [],
            regressionOutputs: [],
          },
        };
      }
    }

    // Write task file into worktree
    writeFileSync(`${worktreeDir}/eval-task.md`, task.problemStatement, 'utf8');

    const preTaskTestOutputs = task.failToPass.map((cmd) => ({
      cmd,
      ...runCommand(cmd, worktreeDir),
    }));

    // Inject context pack (may be empty for baseline)
    if (packContent.trim()) {
      injectPack(worktreeDir, packContent);
    }

    // Task step: Claude edits the code
    const taskPrompt =
      `Complete the task described in eval-task.md in the current directory.` +
      ` If .legreffier/context/session-pack.md exists, read it first as repo context.` +
      (options.taskPromptSuffix ? ` ${options.taskPromptSuffix}` : '');
    if (options.verbose) console.log(`  [task] running claude...`);
    const claudeFlags = ['--permission-mode', 'acceptEdits'];
    if (options.claudeModel) claudeFlags.push('--model', options.claudeModel);
    const taskStep = runClaude(worktreeDir, taskPrompt, claudeFlags);
    const gitState = captureGitState(worktreeDir);

    // Run FAIL_TO_PASS tests
    const testOutputs = task.failToPass.map((cmd) => ({
      cmd,
      ...runCommand(cmd, worktreeDir),
    }));

    // Run PASS_TO_PASS regression checks
    const regressionOutputs = task.passToPass.map((cmd) => ({
      cmd,
      ...runCommand(cmd, worktreeDir),
    }));

    const allFTPPassed = testOutputs.every((t) => t.passed);
    const allPTPPassed = regressionOutputs.every((t) => t.passed);
    const testsPassed = allFTPPassed && allPTPPassed;

    // Eval step: Claude scores the solution (optional — for richer traces)
    let evalResult = '';
    const repoRoot = execSync('git rev-parse --show-toplevel', {
      cwd: worktreeDir,
      encoding: 'utf8',
    }).trim();
    const evalCriteriaPath = resolve(
      repoRoot,
      'evals',
      task.id,
      'criteria.json',
    );
    if (existsSync(evalCriteriaPath)) {
      copyFileSync(evalCriteriaPath, `${worktreeDir}/eval-criteria.json`);
      const evalPrompt =
        `Evaluate the solution against the criteria in eval-criteria.json.` +
        ` For each criterion: state pass/fail, score (0 to max_score), one sentence evidence.` +
        ` Write results to eval-result.md`;
      const evalStep = runClaude(worktreeDir, evalPrompt, [
        '--print',
        '--add-dir',
        worktreeDir,
      ]);
      const resultPath = `${worktreeDir}/eval-result.md`;
      if (existsSync(resultPath)) {
        evalResult = readFileSync(resultPath, 'utf8');
      } else if (!evalStep.passed) {
        evalResult = 'Eval step failed to produce eval-result.md';
      }
    }

    // Score = fraction of FAIL_TO_PASS commands that passed
    // Penalise regressions: if any PASS_TO_PASS fails, cap score at 0.5
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
        taskPrompt: task.problemStatement,
        setupOutputs,
        preTaskTestOutputs,
        evalResult,
        taskStepPassed: taskStep.passed,
        gitStatus: gitState.status,
        gitDiffStat: gitState.diffStat,
        testsPassed,
        testOutputs,
        regressionOutputs,
      },
    };
  } finally {
    removeWorktree(worktreeDir);
  }
}
