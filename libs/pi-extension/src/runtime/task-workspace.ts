import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  type ClaimedTask,
  taskTypeWorkspaceMode,
} from '@themoltnet/agent-runtime';

import { findMainWorktree } from '../vm-manager.js';
import type { PiTaskExecutionPlan } from './execution-plan.js';

export interface PreparedTaskWorkspace {
  mountPath: string;
  mode: 'shared_mount' | 'dedicated_worktree';
  branch: string | null;
  cleanup: () => void;
}

export function resolveTaskWorktreeBranch(
  task: Pick<
    ClaimedTask['task'],
    'taskType' | 'correlationId' | 'id' | 'input'
  >,
): string | null {
  if (taskTypeWorkspaceMode(task.taskType) !== 'dedicated_worktree') {
    return null;
  }

  if (task.taskType === 'fulfill_brief') {
    const input = task.input as {
      brief?: unknown;
      title?: unknown;
      scopeHint?: unknown;
    };
    const title =
      typeof input.title === 'string' && input.title.trim().length > 0
        ? input.title
        : typeof input.brief === 'string' && input.brief.trim().length > 0
          ? input.brief
          : task.taskType;
    const slug = slugifyBranchComponent(title) || 'task';

    if (task.correlationId) {
      return `moltnet/${task.correlationId}/${slug}`;
    }

    const scopeHint =
      typeof input.scopeHint === 'string' && input.scopeHint.trim().length > 0
        ? slugifyBranchComponent(input.scopeHint)
        : 'task';
    return `feat/${scopeHint || 'task'}-${slug}`;
  }

  return `task/${slugifyBranchComponent(task.taskType) || 'task'}-${task.id.slice(0, 8)}`;
}

export function slugifyBranchComponent(input: string): string {
  return slugifyAsciiLower(input, 60);
}

function slugifyAsciiLower(input: string, maxLen: number): string {
  let out = '';
  let pendingDash = false;

  for (const rawChar of input) {
    const char = rawChar.toLowerCase();
    const isAlphaNum =
      (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');

    if (isAlphaNum) {
      if (pendingDash && out.length > 0 && out.length < maxLen) {
        out += '-';
      }
      pendingDash = false;
      if (out.length < maxLen) {
        out += char;
      } else {
        break;
      }
      continue;
    }

    pendingDash = out.length > 0;
  }

  return out;
}

export function prepareTaskWorkspace(
  task: ClaimedTask['task'],
  requestedMountPath: string,
  executionPlan: PiTaskExecutionPlan | null,
): PreparedTaskWorkspace {
  const branch = resolveTaskWorktreeBranch(task);
  if (!branch) {
    return {
      mountPath: requestedMountPath,
      mode: 'shared_mount',
      branch: null,
      cleanup: () => {},
    };
  }

  const mainRepo = findMainWorktree();
  const workspaceId = resolveTaskWorkspaceId(task, executionPlan);
  const worktreeDir = resolveTaskWorktreePath(mainRepo, workspaceId);

  const relMount = relative(mainRepo, requestedMountPath);
  const mountPath =
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
    mountPath,
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

export function resolveTaskWorkspaceId(
  task: Pick<ClaimedTask['task'], 'id'>,
  executionPlan: PiTaskExecutionPlan | null,
): string {
  if (
    executionPlan?.workspaceScope === 'session' &&
    executionPlan.sessionKey !== null
  ) {
    return `session-${encodeURIComponent(executionPlan.sessionKey)}`;
  }
  return `task-${task.id}`;
}

export function resolveTaskWorktreePath(
  mainRepo: string,
  workspaceId: string,
): string {
  return join(mainRepo, '.worktrees', workspaceId);
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
