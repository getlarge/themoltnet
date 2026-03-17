import { copyFile, mkdir, writeFile } from 'node:fs/promises';
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
  return {
    command,
    passed: result.passed,
    output: result.output.slice(0, 2000),
    durationMs: Math.round(performance.now() - t0),
  };
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
    return {
      pr,
      status: 'unit_verified',
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

  const taskFile = resolve(tasksDir, `${verification.pr}.json`);
  const statusFile = resolve(statusDir, `${verification.pr}.json`);

  await writeFile(taskFile, JSON.stringify(task, null, 2));
  await writeFile(statusFile, JSON.stringify(verification, null, 2));
  await writeFile(
    resolve(evalsDir, 'criteria.json'),
    JSON.stringify(criteria, null, 2),
  );

  if (verification.status === 'verified') {
    await copyFile(taskFile, resolve(verifiedDir, `${verification.pr}.json`));
  }
}

export { cleanupAllWorktrees };
