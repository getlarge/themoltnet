import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { ClaimedTask } from '@themoltnet/agent-runtime';

import { findMainWorktree } from '../vm-manager.js';
import type { PiTaskExecutionPlan } from './execution-plan.js';

export interface PreparedTaskWorkspace {
  mountPath: string;
  cwdPath: string;
  mode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  branch: string | null;
  cleanup: () => void;
}

export function prepareTaskWorkspace(
  task: ClaimedTask['task'],
  requestedMountPath: string,
  executionPlan: PiTaskExecutionPlan | null,
): PreparedTaskWorkspace {
  const branch = executionPlan?.worktreeBranch ?? null;
  const workspaceMode = executionPlan?.workspaceMode ?? 'shared_mount';
  const attachedWorkspace = executionPlan?.workspaceAttachment ?? null;

  if (attachedWorkspace) {
    return {
      mountPath: attachedWorkspace.mountPath,
      cwdPath: attachedWorkspace.cwdPath,
      mode: workspaceMode,
      branch,
      cleanup: () => {},
    };
  }

  if (workspaceMode === 'scratch_mount') {
    const mainRepo = findMainWorktree();
    const workspaceId = executionPlan?.workspaceId ?? `task-${task.id}`;
    const scratchDir = resolveTaskScratchPath(mainRepo, workspaceId);
    const keepWorkspace =
      executionPlan?.workspaceScope === 'session' &&
      executionPlan.sessionKey !== null;

    if (keepWorkspace) {
      mkdirSync(scratchDir, { recursive: true });
    } else {
      rmSync(scratchDir, { recursive: true, force: true });
      mkdirSync(scratchDir, { recursive: true });
    }

    return {
      mountPath: scratchDir,
      cwdPath: scratchDir,
      mode: 'scratch_mount',
      branch: null,
      cleanup: keepWorkspace
        ? () => {}
        : () => {
            rmSync(scratchDir, { recursive: true, force: true });
          },
    };
  }

  if (!branch) {
    return {
      mountPath: requestedMountPath,
      cwdPath: requestedMountPath,
      mode: 'shared_mount',
      branch: null,
      cleanup: () => {},
    };
  }

  const mainRepo = findMainWorktree();
  const workspaceId = executionPlan?.workspaceId ?? `task-${task.id}`;
  const worktreeDir = resolveTaskWorktreePath(mainRepo, workspaceId);

  const relMount = relative(mainRepo, requestedMountPath);
  const cwdPath =
    relMount === '' || relMount.startsWith('..')
      ? worktreeDir
      : join(worktreeDir, relMount);
  const keepWorkspace =
    executionPlan?.workspaceScope === 'session' &&
    executionPlan.sessionKey !== null;

  if (keepWorkspace) {
    ensureReusableTaskWorktree(mainRepo, worktreeDir, branch);
  } else {
    removeExistingTaskWorktree(mainRepo, worktreeDir);
    addTaskWorktree(mainRepo, worktreeDir, branch);
  }

  return {
    mountPath: mainRepo,
    cwdPath,
    mode: 'dedicated_worktree',
    branch,
    cleanup: keepWorkspace
      ? () => {}
      : () => {
          execFileSync(
            'git',
            ['-C', mainRepo, 'worktree', 'remove', '--force', worktreeDir],
            { stdio: 'pipe' },
          );
        },
  };
}

export function resolveTaskWorktreePath(
  mainRepo: string,
  workspaceId: string,
): string {
  return join(mainRepo, '.worktrees', workspaceId);
}

export function resolveTaskScratchPath(
  mainRepo: string,
  workspaceId: string,
): string {
  return join(mainRepo, '.moltnet', 'd', 'task-workspaces', workspaceId);
}

function ensureReusableTaskWorktree(
  mainRepo: string,
  worktreeDir: string,
  branch: string,
): void {
  if (isRegisteredWorktree(mainRepo, worktreeDir)) {
    return;
  }

  if (existsSync(worktreeDir)) {
    throw new Error(
      `Expected reusable worktree ${worktreeDir} to be git-managed, but it exists outside git worktree metadata.`,
    );
  }

  addTaskWorktree(mainRepo, worktreeDir, branch);
}

function addTaskWorktree(
  mainRepo: string,
  worktreeDir: string,
  branch: string,
): void {
  const baseRef = resolveWorktreeBaseRef(mainRepo);
  const branchExists = gitRefExists(mainRepo, `refs/heads/${branch}`);
  const addArgs = branchExists
    ? ['-C', mainRepo, 'worktree', 'add', worktreeDir, branch]
    : ['-C', mainRepo, 'worktree', 'add', '-b', branch, worktreeDir, baseRef];
  execFileSync('git', addArgs, { stdio: 'pipe' });
}

function removeExistingTaskWorktree(
  mainRepo: string,
  worktreeDir: string,
): void {
  if (
    !existsSync(worktreeDir) ||
    !isRegisteredWorktree(mainRepo, worktreeDir)
  ) {
    return;
  }
  execFileSync(
    'git',
    ['-C', mainRepo, 'worktree', 'remove', '--force', worktreeDir],
    { stdio: 'pipe' },
  );
}

function isRegisteredWorktree(mainRepo: string, worktreeDir: string): boolean {
  const list = execFileSync(
    'git',
    ['-C', mainRepo, 'worktree', 'list', '--porcelain'],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  const marker = `worktree ${worktreeDir}\n`;
  return list.includes(marker) || list.endsWith(`worktree ${worktreeDir}`);
}

function resolveWorktreeBaseRef(mainRepo: string): string {
  return gitRefExists(mainRepo, 'refs/heads/main') ? 'main' : 'HEAD';
}

function gitRefExists(mainRepo: string, ref: string): boolean {
  try {
    execFileSync(
      'git',
      ['-C', mainRepo, 'show-ref', '--verify', '--quiet', ref],
      {
        stdio: 'pipe',
      },
    );
    return true;
  } catch {
    return false;
  }
}
