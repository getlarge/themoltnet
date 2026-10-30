import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import type { ClaimedTask } from '@themoltnet/agent-runtime';
import { findMainWorktree } from '@themoltnet/sandbox-gondolin';

import type { PiTaskExecutionPlan } from './execution-plan.js';

export interface PreparedTaskWorkspace {
  mountPath: string;
  cwdPath: string;
  mode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  branch: string | null;
  revision: string | null;
  cleanup: () => void;
}

export interface PrepareTaskWorkspaceOptions {
  /**
   * Resume work in the workspace a previous run of the same attempt prepared.
   * The workspace must still exist; it is never seeded, reset or checked
   * against the planned revision, because the agent may have changed it.
   */
  reuseExisting?: boolean;
}

export function prepareTaskWorkspace(
  task: ClaimedTask['task'],
  requestedMountPath: string,
  executionPlan: PiTaskExecutionPlan | null,
  { reuseExisting = false }: PrepareTaskWorkspaceOptions = {},
): PreparedTaskWorkspace {
  const branch = executionPlan?.worktreeBranch ?? null;
  const revision = executionPlan?.workspaceRevision ?? null;
  const workspaceMode = executionPlan?.workspaceMode ?? 'shared_mount';
  const attachedWorkspace = executionPlan?.workspaceAttachment ?? null;

  if (attachedWorkspace) {
    return {
      mountPath: attachedWorkspace.mountPath,
      cwdPath: attachedWorkspace.cwdPath,
      mode: workspaceMode,
      branch,
      revision,
      cleanup: () => {},
    };
  }

  if (workspaceMode === 'scratch_mount') {
    const workspaceId = executionPlan?.workspaceId ?? `task-${task.id}`;
    const scratchDir = resolveTaskScratchPath(requestedMountPath, workspaceId);
    if (reuseExisting) {
      if (!existsSync(scratchDir))
        throw new Error(`Scratch workspace is missing: ${scratchDir}`);
      return {
        mountPath: scratchDir,
        cwdPath: scratchDir,
        mode: 'scratch_mount',
        branch: null,
        revision: null,
        cleanup: () => {},
      };
    }
    const keepWorkspace =
      executionPlan?.workspaceScope === 'session' &&
      executionPlan.sessionKey !== null;

    if (keepWorkspace) {
      mkdirSync(scratchDir, { recursive: true });
    } else {
      rmSync(scratchDir, { recursive: true, force: true });
      mkdirSync(scratchDir, { recursive: true });
    }
    const workspaceSeed = executionPlan?.workspaceSeed ?? null;
    if (workspaceSeed) {
      copyDirectoryContents(workspaceSeed.copyFromPath, scratchDir);
    }

    return {
      mountPath: scratchDir,
      cwdPath: scratchDir,
      mode: 'scratch_mount',
      branch: null,
      revision: null,
      cleanup: keepWorkspace
        ? () => {}
        : () => {
            rmSync(scratchDir, { recursive: true, force: true });
          },
    };
  }

  if (workspaceMode === 'shared_mount') {
    if (revision && !reuseExisting) {
      assertWorkspaceRevision(requestedMountPath, revision);
    }
    return {
      mountPath: requestedMountPath,
      cwdPath: requestedMountPath,
      mode: 'shared_mount',
      branch: null,
      revision,
      cleanup: () => {},
    };
  }
  if (!branch && !revision) {
    throw new Error(
      'Dedicated worktree tasks require either a branch or an immutable revision',
    );
  }

  const mainRepo = findMainWorktreeForDedicatedTask(requestedMountPath);
  const workspaceId = executionPlan?.workspaceId ?? `task-${task.id}`;
  const worktreeDir = resolveTaskWorktreePath(mainRepo, workspaceId);

  const cwdPath = join(
    worktreeDir,
    resolveSourceSubdirectory(requestedMountPath),
  );
  const keepWorkspace =
    executionPlan?.workspaceScope === 'session' &&
    executionPlan.sessionKey !== null;

  const baseRefOverride = executionPlan?.worktreeBaseRef ?? null;
  if (reuseExisting) {
    if (!isRegisteredWorktree(mainRepo, worktreeDir))
      throw new Error(`Task worktree is missing: ${worktreeDir}`);
    return {
      mountPath: mainRepo,
      cwdPath,
      mode: 'dedicated_worktree',
      branch,
      revision,
      cleanup: () => {},
    };
  }
  if (revision) {
    if (keepWorkspace) {
      ensureReusableRevisionWorktree(mainRepo, worktreeDir, revision);
    } else {
      removeExistingTaskWorktree(mainRepo, worktreeDir);
      addDetachedTaskWorktree(mainRepo, worktreeDir, revision);
    }
  } else {
    if (!branch) {
      throw new Error('Branch worktree preparation requires a branch');
    }
    if (keepWorkspace) {
      ensureReusableTaskWorktree(
        mainRepo,
        worktreeDir,
        branch,
        baseRefOverride,
      );
    } else {
      removeExistingTaskWorktree(mainRepo, worktreeDir);
      addTaskWorktree(mainRepo, worktreeDir, branch, baseRefOverride);
    }
  }

  const cleanup = keepWorkspace
    ? () => {}
    : () => {
        execFileSync(
          'git',
          ['-C', mainRepo, 'worktree', 'remove', '--force', worktreeDir],
          { stdio: 'pipe' },
        );
      };
  try {
    assertTaskCwdExists(cwdPath, branch ?? revision);
  } catch (err) {
    cleanup();
    throw err;
  }

  return {
    mountPath: mainRepo,
    cwdPath,
    mode: 'dedicated_worktree',
    branch,
    revision,
    cleanup,
  };
}

/**
 * The source may be the main checkout or a nested/sibling worktree, so only
 * its path relative to its own checkout root carries into the task worktree.
 * Git resolves the toplevel from the physical directory, so a symlinked
 * source is always contained; only a redirected work tree (`core.worktree`,
 * `GIT_WORK_TREE`) can place the source outside it.
 */
function resolveSourceSubdirectory(sourcePath: string): string {
  let sourceRoot: string;
  try {
    sourceRoot = execFileSync(
      'git',
      ['-C', sourcePath, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Dedicated worktree tasks require a source inside a Git work tree: ${message}`,
    );
  }
  const subdir = relative(realpathSync(sourceRoot), realpathSync(sourcePath));
  if (subdir === '..' || subdir.startsWith(`..${sep}`) || isAbsolute(subdir)) {
    throw new Error('Task source must be within its Git checkout');
  }
  return subdir;
}

// Without this check the runtime would create the missing directory when it
// writes its workspace marker, and the agent would start in an empty folder.
function assertTaskCwdExists(cwdPath: string, ref: string | null): void {
  if (!existsSync(cwdPath)) {
    throw new Error(
      `Task source subdirectory does not exist at ${ref}: ${cwdPath}`,
    );
  }
}

function assertWorkspaceRevision(
  workspacePath: string,
  revision: string,
): void {
  let actual: string;
  try {
    actual = execFileSync('git', ['-C', workspacePath, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot verify shared workspace revision ${revision}: ${message}`,
    );
  }
  if (actual.toLowerCase() !== revision.toLowerCase()) {
    throw new Error(
      `Shared workspace is at ${actual}, but task requires ${revision}`,
    );
  }
  let trackedChanges: string;
  try {
    trackedChanges = execFileSync(
      'git',
      [
        '-C',
        workspacePath,
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot verify tracked files for workspace revision ${revision}: ${message}`,
    );
  }
  if (trackedChanges) {
    throw new Error(
      `Workspace at revision ${revision} has modified, staged, or untracked files`,
    );
  }
}

export function resolveTaskWorktreePath(
  mainRepo: string,
  workspaceId: string,
): string {
  return join(mainRepo, '.worktrees', workspaceId);
}

export function resolveTaskScratchPath(
  stateRoot: string,
  workspaceId: string,
): string {
  return join(stateRoot, '.moltnet', 'd', 'task-workspaces', workspaceId);
}

function ensureReusableTaskWorktree(
  mainRepo: string,
  worktreeDir: string,
  branch: string,
  baseRefOverride: string | null = null,
): void {
  if (isRegisteredWorktree(mainRepo, worktreeDir)) {
    return;
  }

  if (existsSync(worktreeDir)) {
    throw new Error(
      `Expected reusable worktree ${worktreeDir} to be git-managed, but it exists outside git worktree metadata.`,
    );
  }

  addTaskWorktree(mainRepo, worktreeDir, branch, baseRefOverride);
}

function ensureReusableRevisionWorktree(
  mainRepo: string,
  worktreeDir: string,
  revision: string,
): void {
  if (isRegisteredWorktree(mainRepo, worktreeDir)) {
    assertWorkspaceRevision(worktreeDir, revision);
    return;
  }
  if (existsSync(worktreeDir)) {
    throw new Error(
      `Expected reusable worktree ${worktreeDir} to be git-managed, but it exists outside git worktree metadata.`,
    );
  }
  addDetachedTaskWorktree(mainRepo, worktreeDir, revision);
}

function addTaskWorktree(
  mainRepo: string,
  worktreeDir: string,
  branch: string,
  baseRefOverride: string | null = null,
): void {
  const branchExists = gitRefExists(mainRepo, `refs/heads/${branch}`);
  // A `fork` continuation supplies the parent branch as the base ref so the
  // new fork branch diverges from the parent's tip rather than main/HEAD.
  const baseRef = baseRefOverride ?? resolveWorktreeBaseRef(mainRepo);
  const addArgs = branchExists
    ? ['-C', mainRepo, 'worktree', 'add', worktreeDir, branch]
    : ['-C', mainRepo, 'worktree', 'add', '-b', branch, worktreeDir, baseRef];
  execFileSync('git', addArgs, { stdio: 'pipe' });
}

function addDetachedTaskWorktree(
  mainRepo: string,
  worktreeDir: string,
  revision: string,
): void {
  execFileSync(
    'git',
    ['-C', mainRepo, 'worktree', 'add', '--detach', worktreeDir, revision],
    { stdio: 'pipe' },
  );
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

function findMainWorktreeForDedicatedTask(startPath: string): string {
  try {
    return findMainWorktree(startPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Dedicated worktree tasks require a git repository: ${message}`,
    );
  }
}

function copyDirectoryContents(sourceDir: string, targetDir: string): void {
  if (!existsSync(sourceDir)) {
    throw new Error(`Workspace seed source is missing: ${sourceDir}`);
  }

  if (existsSync(join(sourceDir, '.git'))) {
    initializeScratchGitRepo(sourceDir, targetDir);
  }

  const resolvedTargetDir = realpathSync(targetDir);
  for (const entry of readdirSync(sourceDir)) {
    const sourceEntry = join(sourceDir, entry);
    if (shouldSkipSeedEntry(sourceEntry, entry, resolvedTargetDir)) {
      continue;
    }

    cpSync(sourceEntry, join(targetDir, entry), {
      recursive: true,
    });
  }
}

function initializeScratchGitRepo(sourceDir: string, targetDir: string): void {
  execFileSync('git', ['-C', targetDir, 'init'], { stdio: 'pipe' });

  let headCommit: string | null = null;
  try {
    headCommit = execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch {
    headCommit = null;
  }

  if (!headCommit) {
    return;
  }

  execFileSync('git', ['-C', targetDir, 'remote', 'add', 'origin', sourceDir], {
    stdio: 'pipe',
  });
  execFileSync(
    'git',
    ['-C', targetDir, 'fetch', '--quiet', '--depth=1', 'origin', headCommit],
    { stdio: 'pipe' },
  );
  execFileSync(
    'git',
    ['-C', targetDir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'],
    {
      stdio: 'pipe',
    },
  );
}

function shouldSkipSeedEntry(
  sourceEntry: string,
  entryName: string,
  resolvedTargetDir: string,
): boolean {
  if (entryName === '.git') {
    return true;
  }

  const resolvedSourceEntry = realpathSync(sourceEntry);
  return (
    resolvedTargetDir === resolvedSourceEntry ||
    resolvedTargetDir.startsWith(`${resolvedSourceEntry}${sep}`)
  );
}
