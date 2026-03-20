import { appendFile, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { TasksmithTask } from '@moltnet/context-evals';
import {
  cleanupAllWorktrees,
  createWorktree,
  removeWorktree,
} from '@moltnet/context-evals';
import { runShellCommand } from '@moltnet/context-evals/process';

import type {
  CommandCheck,
  CriteriaItem,
  VerificationResult,
} from './types.js';

// ── Constants ──

const UNIT_TEST_TIMEOUT_MS = 120_000;
const E2E_TEST_TIMEOUT_MS = 300_000;
const INSTALL_TIMEOUT_MS = 90_000;
const DOCKER_STACK_TIMEOUT_MS = 120_000;

// ── Helpers ──

export function isDockerDependent(command: string): boolean {
  return /\be2e\b/i.test(command) || /test:e2e/.test(command);
}

export function classifyTestCommand(command: string): {
  isE2e: boolean;
  timeoutMs: number;
} {
  const isE2e = isDockerDependent(command);
  return {
    isE2e,
    timeoutMs: isE2e ? E2E_TEST_TIMEOUT_MS : UNIT_TEST_TIMEOUT_MS,
  };
}

export function partitionCommands(commands: string[]): {
  unit: string[];
  docker: string[];
} {
  const unit: string[] = [];
  const docker: string[] = [];
  for (const cmd of commands) {
    (isDockerDependent(cmd) ? docker : unit).push(cmd);
  }
  return { unit, docker };
}

async function runTestCommand(
  command: string,
  cwd: string,
): Promise<CommandCheck> {
  const { timeoutMs } = classifyTestCommand(command);
  const t0 = performance.now();
  const result = await runShellCommand(command, cwd, timeoutMs);

  // Several runners exit 0 even when the command matched no package, no test
  // files, or no actual test cases. Treat those as failed checks.
  const noMatch = outputIndicatesNoTestsRun(result.output);

  return {
    command,
    passed: result.passed && !noMatch,
    output: result.output.slice(0, 2000),
    durationMs: Math.round(performance.now() - t0),
  };
}

export function outputIndicatesNoTestsRun(output: string): boolean {
  return (
    output.includes('No projects matched the filters') ||
    output.includes('No test files found') ||
    output.includes('[no tests to run]') ||
    /Test Files\s+\d+\s+skipped/.test(output)
  );
}

// ── Docker stack lifecycle ──

export async function startE2eStack(repoRoot: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[docker] Starting e2e stack...');
  const result = await runShellCommand(
    'COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build',
    repoRoot,
    DOCKER_STACK_TIMEOUT_MS,
  );
  if (!result.passed) {
    throw new Error(
      `Failed to start e2e stack: ${result.output.slice(0, 500)}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log('[docker] e2e stack started');
}

export async function stopE2eStack(repoRoot: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[docker] Stopping e2e stack...');
  await runShellCommand(
    'COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml down -v',
    repoRoot,
    DOCKER_STACK_TIMEOUT_MS,
  );
  await runShellCommand('docker image prune -f', repoRoot, 30_000);
  // eslint-disable-next-line no-console
  console.log('[docker] e2e stack stopped and images pruned');
}

// ── Verification per task ──

export interface VerifyTaskOptions {
  debug: boolean;
  skipDocker: boolean;
}

// ── Grouped verification (shared worktrees per PR) ──

export interface TaskGroupItem {
  task: TasksmithTask;
  criteria: CriteriaItem[];
}

export interface GroupVerificationResult {
  pr: number;
  results: Array<{
    task: TasksmithTask;
    criteria: CriteriaItem[];
    verification: VerificationResult;
  }>;
}

/**
 * Verify all sub-tasks for a single PR using shared worktrees.
 * Creates fixture + gold worktrees once, then runs checks for each sub-task.
 */
export async function verifyTaskGroup(
  pr: number,
  items: TaskGroupItem[],
  options: VerifyTaskOptions,
): Promise<GroupVerificationResult> {
  const { debug, skipDocker } = options;
  const results: GroupVerificationResult['results'] = [];

  if (items.length === 0) {
    return { pr, results };
  }

  // All sub-tasks of a PR share the same refs
  const fixtureRef = items[0].task.fixture_ref;
  const goldFixRef = items[0].task.gold_fix_ref;

  for (const { task } of items) {
    if (task.fixture_ref !== fixtureRef || task.gold_fix_ref !== goldFixRef) {
      throw new Error(
        `PR #${pr}: sub-tasks have mismatched refs — cannot share worktrees`,
      );
    }
  }

  let fixtureWorktree: string | undefined;
  let goldWorktree: string | undefined;
  let fixtureInstalled = false;
  let goldInstalled = false;

  try {
    for (const { task, criteria } of items) {
      const failToPass = skipDocker
        ? partitionCommands(task.fail_to_pass)
        : { unit: task.fail_to_pass, docker: [] as string[] };
      const passToPass = skipDocker
        ? partitionCommands(task.pass_to_pass)
        : { unit: task.pass_to_pass, docker: [] as string[] };

      if (failToPass.unit.length === 0 && skipDocker) {
        results.push({
          task,
          criteria,
          verification: {
            pr,
            status: 'extracted_unverified',
            deferredDockerCommands: {
              failToPass: failToPass.docker,
              passToPass: passToPass.docker,
            },
          },
        });
        continue;
      }

      // ── Red check (lazy init fixture worktree) ──
      if (!fixtureWorktree) {
        // eslint-disable-next-line no-console
        console.log(
          `[verify] PR #${pr}: creating fixture worktree at ${fixtureRef.slice(0, 8)}...`,
        );
        fixtureWorktree = await createWorktree(fixtureRef, `pr-${pr}-fixture`);
      }
      if (!fixtureInstalled) {
        await runShellCommand(
          'pnpm install --frozen-lockfile',
          fixtureWorktree,
          INSTALL_TIMEOUT_MS,
        );
        fixtureInstalled = true;
      }

      const redChecks: CommandCheck[] = [];
      let fixtureGreen = false;
      for (const cmd of failToPass.unit) {
        const check = await runTestCommand(cmd, fixtureWorktree);
        redChecks.push(check);
        if (check.passed) {
          fixtureGreen = true;
          // eslint-disable-next-line no-console
          console.log(
            `[verify] ${task.task_id}: FIXTURE_ALREADY_GREEN — "${cmd}"`,
          );
          break;
        }
      }
      if (fixtureGreen) {
        results.push({
          task,
          criteria,
          verification: {
            pr,
            status: 'fixture_already_green',
            redCheck: {
              passed: false,
              commands: redChecks,
              durationMs: redChecks.reduce((s, c) => s + c.durationMs, 0),
            },
            skipReason: `fail_to_pass passed on fixture`,
          },
        });
        continue;
      }
      const redDuration = redChecks.reduce((s, c) => s + c.durationMs, 0);

      // ── Green check (lazy init gold worktree) ──
      if (!goldWorktree) {
        // eslint-disable-next-line no-console
        console.log(
          `[verify] PR #${pr}: creating gold worktree at ${goldFixRef.slice(0, 8)}...`,
        );
        goldWorktree = await createWorktree(goldFixRef, `pr-${pr}-gold`);
      }
      if (!goldInstalled) {
        await runShellCommand(
          'pnpm install --frozen-lockfile',
          goldWorktree,
          INSTALL_TIMEOUT_MS,
        );
        goldInstalled = true;
      }

      const greenChecks: CommandCheck[] = [];
      let fixFails = false;
      for (const cmd of failToPass.unit) {
        const check = await runTestCommand(cmd, goldWorktree);
        greenChecks.push(check);
        if (!check.passed) {
          fixFails = true;
          // eslint-disable-next-line no-console
          console.log(`[verify] ${task.task_id}: FIX_DOESNT_PASS — "${cmd}"`);
          break;
        }
      }
      if (fixFails) {
        results.push({
          task,
          criteria,
          verification: {
            pr,
            status: 'fix_doesnt_pass',
            redCheck: {
              passed: true,
              commands: redChecks,
              durationMs: redDuration,
            },
            greenCheck: {
              passed: false,
              commands: greenChecks,
              durationMs: greenChecks.reduce((s, c) => s + c.durationMs, 0),
            },
            skipReason: `fail_to_pass failed on gold fix`,
          },
        });
        continue;
      }
      const greenDuration = greenChecks.reduce((s, c) => s + c.durationMs, 0);

      // ── Regression check ──
      const removed: string[] = [];
      for (const cmd of passToPass.unit) {
        const check = await runTestCommand(cmd, fixtureWorktree);
        if (!check.passed) removed.push(cmd);
      }

      const hasDeferred =
        failToPass.docker.length > 0 || passToPass.docker.length > 0;
      const deferredDockerCommands = hasDeferred
        ? { failToPass: failToPass.docker, passToPass: passToPass.docker }
        : undefined;
      const status = deferredDockerCommands ? 'unit_verified' : 'verified';

      // eslint-disable-next-line no-console
      console.log(
        `[verify] ${task.task_id}: ${status === 'verified' ? 'VERIFIED' : status}`,
      );

      results.push({
        task,
        criteria,
        verification: {
          pr,
          status,
          redCheck: {
            passed: true,
            commands: redChecks,
            durationMs: redDuration,
          },
          greenCheck: {
            passed: true,
            commands: greenChecks,
            durationMs: greenDuration,
          },
          regressionCheck: { passed: removed.length === 0, removed },
          deferredDockerCommands,
        },
      });
    }
  } finally {
    if (!debug) {
      if (fixtureWorktree) await removeWorktree(fixtureWorktree);
      if (goldWorktree) await removeWorktree(goldWorktree);
    }
  }

  return { pr, results };
}

export async function verifyTask(
  task: TasksmithTask,
  pr: number,
  options: VerifyTaskOptions,
): Promise<VerificationResult> {
  const { debug, skipDocker } = options;
  let fixtureWorktree: string | undefined;
  let goldWorktree: string | undefined;

  const failToPass = skipDocker
    ? partitionCommands(task.fail_to_pass)
    : { unit: task.fail_to_pass, docker: [] as string[] };
  const passToPass = skipDocker
    ? partitionCommands(task.pass_to_pass)
    : { unit: task.pass_to_pass, docker: [] as string[] };

  if (failToPass.unit.length === 0 && skipDocker) {
    // eslint-disable-next-line no-console
    console.log(
      `[verify] PR #${pr}: all fail_to_pass are Docker-dependent, deferring`,
    );
    // Nothing was actually verified — all checks are Docker-dependent.
    // Use extracted_unverified (not unit_verified) to avoid implying unit tests passed.
    return {
      pr,
      status: 'extracted_unverified',
      deferredDockerCommands: {
        failToPass: failToPass.docker,
        passToPass: passToPass.docker,
      },
    };
  }

  try {
    // ── Red check ──
    // eslint-disable-next-line no-console
    console.log(
      `[verify] PR #${pr}: red check at ${task.fixture_ref.slice(0, 8)}...`,
    );
    fixtureWorktree = await createWorktree(
      task.fixture_ref,
      `pr-${pr}-fixture`,
    );
    await runShellCommand(
      'pnpm install --frozen-lockfile',
      fixtureWorktree,
      INSTALL_TIMEOUT_MS,
    );

    const redChecks: CommandCheck[] = [];
    for (const cmd of failToPass.unit) {
      const check = await runTestCommand(cmd, fixtureWorktree);
      redChecks.push(check);
      if (check.passed) {
        // eslint-disable-next-line no-console
        console.log(
          `[verify] PR #${pr}: FIXTURE_ALREADY_GREEN — "${cmd}" passed on fixture`,
        );
        // eslint-disable-next-line no-console
        console.log(`[verify]   output: ${check.output.slice(0, 500)}`);
        return {
          pr,
          status: 'fixture_already_green',
          redCheck: {
            passed: false,
            commands: redChecks,
            durationMs: redChecks.reduce((s, c) => s + c.durationMs, 0),
          },
          skipReason: `fail_to_pass command passed on fixture: ${cmd}`,
        };
      }
    }
    const redDuration = redChecks.reduce((s, c) => s + c.durationMs, 0);

    // ── Green check ──
    // eslint-disable-next-line no-console
    console.log(
      `[verify] PR #${pr}: green check at ${task.gold_fix_ref.slice(0, 8)}...`,
    );
    goldWorktree = await createWorktree(task.gold_fix_ref, `pr-${pr}-gold`);
    await runShellCommand(
      'pnpm install --frozen-lockfile',
      goldWorktree,
      INSTALL_TIMEOUT_MS,
    );

    const greenChecks: CommandCheck[] = [];
    for (const cmd of failToPass.unit) {
      const check = await runTestCommand(cmd, goldWorktree);
      greenChecks.push(check);
      if (!check.passed) {
        // eslint-disable-next-line no-console
        console.log(
          `[verify] PR #${pr}: FIX_DOESNT_PASS — "${cmd}" failed on gold fix`,
        );
        // eslint-disable-next-line no-console
        console.log(`[verify]   error: ${check.output.slice(0, 500)}`);
        return {
          pr,
          status: 'fix_doesnt_pass',
          redCheck: {
            passed: true,
            commands: redChecks,
            durationMs: redDuration,
          },
          greenCheck: {
            passed: false,
            commands: greenChecks,
            durationMs: greenChecks.reduce((s, c) => s + c.durationMs, 0),
          },
          skipReason: `fail_to_pass command failed on gold fix: ${cmd}`,
        };
      }
    }
    const greenDuration = greenChecks.reduce((s, c) => s + c.durationMs, 0);

    // ── Regression check ──
    // eslint-disable-next-line no-console
    console.log(`[verify] PR #${pr}: regression check...`);
    const removed: string[] = [];
    for (const cmd of passToPass.unit) {
      const check = await runTestCommand(cmd, fixtureWorktree);
      if (!check.passed) {
        // eslint-disable-next-line no-console
        console.log(
          `[verify] PR #${pr}: removing pass_to_pass "${cmd}" (fails on fixture)`,
        );
        removed.push(cmd);
      }
    }

    const hasDeferred =
      failToPass.docker.length > 0 || passToPass.docker.length > 0;
    const deferredDockerCommands = hasDeferred
      ? { failToPass: failToPass.docker, passToPass: passToPass.docker }
      : undefined;
    const status = deferredDockerCommands ? 'unit_verified' : 'verified';

    return {
      pr,
      status,
      redCheck: { passed: true, commands: redChecks, durationMs: redDuration },
      greenCheck: {
        passed: true,
        commands: greenChecks,
        durationMs: greenDuration,
      },
      regressionCheck: { passed: removed.length === 0, removed },
      deferredDockerCommands,
    };
  } finally {
    if (!debug) {
      if (fixtureWorktree) await removeWorktree(fixtureWorktree);
      if (goldWorktree) await removeWorktree(goldWorktree);
    }
  }
}

// ── Docker verification phase ──

export async function verifyDockerCommands(
  task: TasksmithTask,
  deferred: NonNullable<VerificationResult['deferredDockerCommands']>,
  debug: boolean,
): Promise<
  Pick<
    VerificationResult,
    'status' | 'redCheck' | 'greenCheck' | 'regressionCheck' | 'skipReason'
  >
> {
  let fixtureWorktree: string | undefined;
  let goldWorktree: string | undefined;

  try {
    fixtureWorktree = await createWorktree(
      task.fixture_ref,
      `docker-${task.task_id}-fixture`,
    );
    await runShellCommand(
      'pnpm install --frozen-lockfile',
      fixtureWorktree,
      INSTALL_TIMEOUT_MS,
    );

    const redChecks: CommandCheck[] = [];
    for (const cmd of deferred.failToPass) {
      const check = await runTestCommand(cmd, fixtureWorktree);
      redChecks.push(check);
      if (check.passed) {
        // eslint-disable-next-line no-console
        console.log(
          `[verify] Docker FIXTURE_ALREADY_GREEN — "${cmd}"\n  output: ${check.output.slice(0, 500)}`,
        );
        return {
          status: 'fixture_already_green',
          redCheck: {
            passed: false,
            commands: redChecks,
            durationMs: redChecks.reduce((s, c) => s + c.durationMs, 0),
          },
          skipReason: `Docker fail_to_pass passed on fixture: ${cmd}`,
        };
      }
    }
    const redDuration = redChecks.reduce((s, c) => s + c.durationMs, 0);

    goldWorktree = await createWorktree(
      task.gold_fix_ref,
      `docker-${task.task_id}-gold`,
    );
    await runShellCommand(
      'pnpm install --frozen-lockfile',
      goldWorktree,
      INSTALL_TIMEOUT_MS,
    );

    const greenChecks: CommandCheck[] = [];
    for (const cmd of deferred.failToPass) {
      const check = await runTestCommand(cmd, goldWorktree);
      greenChecks.push(check);
      if (!check.passed) {
        // eslint-disable-next-line no-console
        console.log(
          `[verify] Docker FIX_DOESNT_PASS — "${cmd}"\n  error: ${check.output.slice(0, 500)}`,
        );
        return {
          status: 'fix_doesnt_pass',
          redCheck: {
            passed: true,
            commands: redChecks,
            durationMs: redDuration,
          },
          greenCheck: {
            passed: false,
            commands: greenChecks,
            durationMs: greenChecks.reduce((s, c) => s + c.durationMs, 0),
          },
          skipReason: `Docker fail_to_pass failed on gold fix: ${cmd}`,
        };
      }
    }
    const greenDuration = greenChecks.reduce((s, c) => s + c.durationMs, 0);

    const removed: string[] = [];
    for (const cmd of deferred.passToPass) {
      const check = await runTestCommand(cmd, fixtureWorktree);
      if (!check.passed) removed.push(cmd);
    }

    return {
      status: 'verified',
      redCheck: { passed: true, commands: redChecks, durationMs: redDuration },
      greenCheck: {
        passed: true,
        commands: greenChecks,
        durationMs: greenDuration,
      },
      regressionCheck: { passed: removed.length === 0, removed },
    };
  } finally {
    if (!debug) {
      if (fixtureWorktree) await removeWorktree(fixtureWorktree);
      if (goldWorktree) await removeWorktree(goldWorktree);
    }
  }
}

// ── Output writing ──

export async function writeVerifiedTask(
  repoRoot: string,
  task: TasksmithTask,
  criteria: CriteriaItem[],
  verification: VerificationResult,
): Promise<void> {
  const tasksDir = resolve(repoRoot, 'tasksmith', 'candidates', 'tasks');
  const statusDir = resolve(repoRoot, 'tasksmith', 'candidates', 'status');
  const verifiedDir = resolve(repoRoot, 'tasksmith', 'verified');
  const evalsDir = resolve(repoRoot, 'evals', task.task_id);

  await mkdir(tasksDir, { recursive: true });
  await mkdir(statusDir, { recursive: true });
  await mkdir(verifiedDir, { recursive: true });
  await mkdir(evalsDir, { recursive: true });

  // File key: strip "pr-" prefix from task_id (e.g., "pr-279-0" → "279-0")
  const fileKey = task.task_id.replace(/^pr-/, '');
  const taskFile = resolve(tasksDir, `${fileKey}.json`);
  const statusFile = resolve(statusDir, `${fileKey}.json`);

  await writeFile(taskFile, JSON.stringify(task, null, 2));
  await writeFile(statusFile, JSON.stringify(verification, null, 2));
  await writeFile(
    resolve(evalsDir, 'criteria.json'),
    JSON.stringify(criteria, null, 2),
  );

  if (verification.status === 'verified') {
    await copyFile(taskFile, resolve(verifiedDir, `${fileKey}.json`));
  }

  // Append failure details to a JSONL summary for GEPA analysis
  if (
    verification.status === 'fixture_already_green' ||
    verification.status === 'fix_doesnt_pass'
  ) {
    const failedCommands = [
      ...(verification.redCheck?.commands ?? []),
      ...(verification.greenCheck?.commands ?? []),
    ].filter((c) =>
      verification.status === 'fixture_already_green' ? c.passed : !c.passed,
    );
    const summary = {
      pr: verification.pr,
      status: verification.status,
      taskId: task.task_id,
      failedCommands: failedCommands.map((c) => ({
        command: c.command,
        output: c.output,
      })),
      skipReason: verification.skipReason,
    };
    const failuresFile = resolve(statusDir, 'failures.jsonl');
    await appendFile(failuresFile, JSON.stringify(summary) + '\n');
  }
}

export { cleanupAllWorktrees };
