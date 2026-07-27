import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import type { TaskAttempt } from '@moltnet/tasks';

import type {
  ListedRuntimeSlotContext,
  RuntimeSlotStore,
} from './execution-plan-cache.js';

const TERMINAL_ATTEMPT_STATUSES = new Set<TaskAttempt['status']>([
  'completed',
  'failed',
  'cancelled',
  'aborted',
  'timed_out',
]);

export interface RuntimeResourceReaperInput {
  agentName: string;
  mainWorktree: string | null;
  now?: number;
  runtimeProfileId: string;
  sessionRootDir: string;
  scratchRootDir: string;
  teamId: string;
}

export interface RuntimeResourceReaperDeps {
  runtimeSlotStore: RuntimeSlotStore;
  taskReader: {
    listAttempts(taskId: string): Promise<TaskAttempt[]>;
  };
}

export interface RuntimeResourceReaperResult {
  failed: number;
  removedSessions: number;
  removedWorkspaces: number;
  scanned: number;
  unsafePaths: number;
}

/**
 * Reap daemon-owned local resources whose runtime slot is no longer usable.
 * Idle slots expire by TTL. Active slots are only treated as crash orphans
 * after their task attempt is terminal, so a long-running worker is never
 * reaped merely because its session TTL elapsed.
 */
export async function reapRuntimeSlotResources(
  deps: RuntimeResourceReaperDeps,
  input: RuntimeResourceReaperInput,
): Promise<RuntimeResourceReaperResult> {
  const now = input.now ?? Date.now();
  const [active, idle] = await Promise.all([
    deps.runtimeSlotStore.listSlots({
      agentName: input.agentName,
      limit: 200,
      runtimeProfileId: input.runtimeProfileId,
      state: 'active',
      teamId: input.teamId,
    }),
    deps.runtimeSlotStore.listSlots({
      agentName: input.agentName,
      limit: 200,
      runtimeProfileId: input.runtimeProfileId,
      state: 'idle',
      teamId: input.teamId,
    }),
  ]);
  const slots = [...active, ...idle];
  const reaped = new Set<string>();

  for (const item of idle) {
    if (item.slot.expiresAtMs <= now) reaped.add(item.slot.id);
  }
  for (const item of active) {
    if (await attemptIsTerminal(deps, item)) reaped.add(item.slot.id);
  }

  const retainedSessionDirs = new Set(
    slots
      .filter((item) => !reaped.has(item.slot.id))
      .flatMap((item) =>
        item.session?.sessionDir ? [resolve(item.session.sessionDir)] : [],
      ),
  );
  const retainedWorkspacePaths = new Set(
    slots
      .filter((item) => !reaped.has(item.slot.id))
      .flatMap((item) =>
        item.workspace?.worktreePath
          ? [resolve(item.workspace.worktreePath)]
          : [],
      ),
  );
  const result: RuntimeResourceReaperResult = {
    failed: 0,
    removedSessions: 0,
    removedWorkspaces: 0,
    scanned: slots.length,
    unsafePaths: 0,
  };

  for (const item of slots) {
    if (!reaped.has(item.slot.id)) continue;
    const sessionDir = item.session?.sessionDir;
    if (sessionDir && !retainedSessionDirs.has(resolve(sessionDir))) {
      if (!isPathInside(sessionDir, input.sessionRootDir)) {
        result.unsafePaths++;
      } else {
        try {
          if (existsSync(sessionDir)) {
            rmSync(sessionDir, { force: true, recursive: true });
            result.removedSessions++;
          }
        } catch {
          result.failed++;
        }
      }
    }

    const workspacePath = item.workspace?.worktreePath;
    if (!workspacePath || retainedWorkspacePaths.has(resolve(workspacePath))) {
      continue;
    }
    const workspaceRoot =
      item.workspace?.kind === 'scratch'
        ? input.scratchRootDir
        : input.mainWorktree
          ? resolve(input.mainWorktree, '.worktrees')
          : null;
    if (!workspaceRoot || !isPathInside(workspacePath, workspaceRoot)) {
      result.unsafePaths++;
      continue;
    }
    try {
      if (item.workspace?.kind !== 'scratch' && input.mainWorktree) {
        if (removeWorkspace(input.mainWorktree, workspacePath)) {
          result.removedWorkspaces++;
        }
      } else if (existsSync(workspacePath)) {
        rmSync(workspacePath, { force: true, recursive: true });
        result.removedWorkspaces++;
      }
    } catch {
      result.failed++;
    }
  }

  reapLegacyOrphanWorktrees(
    input,
    retainedSessionDirs,
    retainedWorkspacePaths,
    result,
  );

  return result;
}

/**
 * Older daemon versions named correlation-scoped worktrees
 * `session-agent%3A...` and could leave them registered after both their slot
 * row and local Pi session disappeared. They cannot be discovered through the
 * runtime-slot API, so scan only that exact legacy namespace. A matching Pi
 * session or retained slot path proves the worktree is still owned.
 */
function reapLegacyOrphanWorktrees(
  input: RuntimeResourceReaperInput,
  retainedSessionDirs: Set<string>,
  retainedWorkspacePaths: Set<string>,
  result: RuntimeResourceReaperResult,
): void {
  if (!input.mainWorktree) return;
  const workspaceRoot = resolve(input.mainWorktree, '.worktrees');
  if (!existsSync(workspaceRoot)) return;

  for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('session-agent%3A')) {
      continue;
    }
    const workspacePath = resolve(workspaceRoot, entry.name);
    if (retainedWorkspacePaths.has(workspacePath)) continue;

    const sessionDir = resolve(
      input.sessionRootDir,
      entry.name.slice('session-'.length),
    );
    if (retainedSessionDirs.has(sessionDir) || existsSync(sessionDir)) continue;

    try {
      if (removeWorkspace(input.mainWorktree, workspacePath)) {
        result.removedWorkspaces++;
      }
    } catch {
      result.failed++;
    }
  }
}

async function attemptIsTerminal(
  deps: RuntimeResourceReaperDeps,
  item: ListedRuntimeSlotContext,
): Promise<boolean> {
  try {
    const attempts = await deps.taskReader.listAttempts(item.slot.lastTaskId);
    const attempt = attempts.find(
      (candidate) => candidate.attemptN === item.slot.lastAttemptN,
    );
    return !attempt || TERMINAL_ATTEMPT_STATUSES.has(attempt.status);
  } catch {
    // Failure to prove terminal must retain resources.
    return false;
  }
}

function isPathInside(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolvedPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isRegisteredWorktree(mainRepo: string, worktreePath: string): boolean {
  try {
    const list = execFileSync(
      'git',
      ['-C', mainRepo, 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const expected = canonicalPath(worktreePath);
    return list
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .some(
        (line) => canonicalPath(line.slice('worktree '.length)) === expected,
      );
  } catch {
    return false;
  }
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function removeWorkspace(mainRepo: string, workspacePath: string): boolean {
  if (isRegisteredWorktree(mainRepo, workspacePath)) {
    execFileSync(
      'git',
      ['-C', mainRepo, 'worktree', 'remove', '--force', workspacePath],
      { stdio: 'pipe' },
    );
    return true;
  } else if (existsSync(workspacePath)) {
    rmSync(workspacePath, { force: true, recursive: true });
    return true;
  }
  return false;
}
