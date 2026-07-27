import { execFile } from 'node:child_process';
import {
  type Dirent,
  existsSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import type { TaskAttempt } from '@moltnet/tasks';

import type {
  ListedRuntimeSlotContext,
  RuntimeSlotStore,
} from './execution-plan-cache.js';
import { runtimeSlotKeyBelongsToInstance } from './task-execution-plan.js';

const RUNTIME_SLOT_PAGE_LIMIT = 200;
const ATTEMPT_LOOKUP_CONCURRENCY = 8;
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
  runtimeInstanceId: string;
  runtimeProfileId: string;
  sessionRootDir: string;
  scratchRootDir: string;
  teamId: string;
}

export interface RuntimeResourceReaperIssue {
  kind: 'failure' | 'unsafe_path';
  path: string;
  reason: string;
  root: string | null;
  slotId: string | null;
}

export interface RuntimeResourceReaperDeps {
  onIssue?: (issue: RuntimeResourceReaperIssue) => void;
  runtimeSlotStore: RuntimeSlotStore;
  taskReader: {
    listAttempts(taskId: string): Promise<TaskAttempt[]>;
  };
}

export interface RuntimeResourceReaperResult {
  failed: number;
  failures: RuntimeResourceReaperIssue[];
  removedSessions: number;
  removedWorkspaces: number;
  scanned: number;
  truncated: boolean;
  unsafePathDetails: RuntimeResourceReaperIssue[];
  unsafePaths: number;
}

interface OwnedSlotPage {
  items: ListedRuntimeSlotContext[];
  truncated: boolean;
}

type WorktreeRegistry =
  | { kind: 'ready'; paths: Set<string> }
  | { kind: 'unavailable'; reason: string };

/**
 * Reap daemon-owned local resources whose runtime slot is no longer usable.
 * The destructive path is deliberately conservative: uncertainty about slot
 * ownership, attempt state, listing completeness, or real filesystem
 * containment retains resources rather than risking another daemon's data.
 */
export async function reapRuntimeSlotResources(
  deps: RuntimeResourceReaperDeps,
  input: RuntimeResourceReaperInput,
): Promise<RuntimeResourceReaperResult> {
  const now = input.now ?? Date.now();
  const [activePage, idlePage] = await Promise.all([
    listOwnedSlots(deps.runtimeSlotStore, input, 'active'),
    listOwnedSlots(deps.runtimeSlotStore, input, 'idle'),
  ]);
  const active = activePage.items;
  const idle = idlePage.items;
  const slots = [...active, ...idle];
  const result: RuntimeResourceReaperResult = {
    failed: 0,
    failures: [],
    removedSessions: 0,
    removedWorkspaces: 0,
    scanned: slots.length,
    truncated: activePage.truncated || idlePage.truncated,
    unsafePathDetails: [],
    unsafePaths: 0,
  };
  const reaped = new Set(
    idle
      .filter((item) => item.slot.expiresAtMs <= now)
      .map((item) => item.slot.id),
  );
  for (const slotId of await findTerminalActiveSlotIds(deps, active, result)) {
    reaped.add(slotId);
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
  const worktrees = input.mainWorktree
    ? await listRegisteredWorktrees(input.mainWorktree)
    : { kind: 'ready' as const, paths: new Set<string>() };

  for (const item of slots) {
    if (!reaped.has(item.slot.id)) continue;
    if (!(await slotStillQualifiesForReaping(deps, input, item, now, result))) {
      continue;
    }

    const sessionDir = item.session?.sessionDir;
    if (
      sessionDir &&
      !retainedSessionDirs.has(resolve(sessionDir)) &&
      existsSync(sessionDir)
    ) {
      if (!isRealPathInsideRoot(sessionDir, input.sessionRootDir)) {
        recordUnsafePath(
          deps,
          result,
          item.slot.id,
          sessionDir,
          input.sessionRootDir,
        );
      } else {
        try {
          rmSync(sessionDir, { force: true, recursive: true });
          result.removedSessions++;
        } catch (err) {
          recordFailure(
            deps,
            result,
            item.slot.id,
            sessionDir,
            input.sessionRootDir,
            err,
          );
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
    if (!workspaceRoot) {
      recordUnsafePath(deps, result, item.slot.id, workspacePath, null);
      continue;
    }
    await removeWorkspace(
      deps,
      result,
      worktrees,
      input.mainWorktree,
      item.slot.id,
      workspacePath,
      workspaceRoot,
      item.workspace?.kind === 'scratch',
    );
  }

  // A full retained-path set is required before scanning worktrees that have
  // no runtime-slot row. Hitting the API maximum makes that proof impossible.
  if (!result.truncated) {
    await reapLegacyOrphanWorktrees(
      deps,
      input,
      worktrees,
      retainedSessionDirs,
      retainedWorkspacePaths,
      result,
    );
  }

  return result;
}

async function listOwnedSlots(
  store: RuntimeSlotStore,
  input: RuntimeResourceReaperInput,
  state: 'active' | 'idle',
): Promise<OwnedSlotPage> {
  const listed = await store.listSlots({
    agentName: input.agentName,
    limit: RUNTIME_SLOT_PAGE_LIMIT,
    runtimeProfileId: input.runtimeProfileId,
    state,
    teamId: input.teamId,
  });
  return {
    items: listed.filter((item) =>
      runtimeSlotKeyBelongsToInstance(
        item.slot.slotKey,
        input.runtimeInstanceId,
      ),
    ),
    // The API has no continuation cursor. Treat a full page as incomplete
    // even when it happens to contain exactly all matching rows.
    truncated: listed.length === RUNTIME_SLOT_PAGE_LIMIT,
  };
}

async function findTerminalActiveSlotIds(
  deps: RuntimeResourceReaperDeps,
  active: ListedRuntimeSlotContext[],
  result: RuntimeResourceReaperResult,
): Promise<Set<string>> {
  const byTask = new Map<string, ListedRuntimeSlotContext[]>();
  for (const item of active) {
    const taskSlots = byTask.get(item.slot.lastTaskId) ?? [];
    taskSlots.push(item);
    byTask.set(item.slot.lastTaskId, taskSlots);
  }

  const terminal = new Set<string>();
  await mapWithConcurrency(
    [...byTask.entries()],
    ATTEMPT_LOOKUP_CONCURRENCY,
    async ([taskId, taskSlots]) => {
      let attempts: TaskAttempt[];
      try {
        attempts = await deps.taskReader.listAttempts(taskId);
      } catch (err) {
        recordFailure(deps, result, null, `task:${taskId}`, null, err);
        return;
      }
      for (const item of taskSlots) {
        const attempt = attempts.find(
          (candidate) => candidate.attemptN === item.slot.lastAttemptN,
        );
        // Failure to prove terminal must retain resources.
        if (attempt && TERMINAL_ATTEMPT_STATUSES.has(attempt.status)) {
          terminal.add(item.slot.id);
        }
      }
    },
  );
  return terminal;
}

async function slotStillQualifiesForReaping(
  deps: RuntimeResourceReaperDeps,
  input: RuntimeResourceReaperInput,
  original: ListedRuntimeSlotContext,
  now: number,
  result: RuntimeResourceReaperResult,
): Promise<boolean> {
  let page: OwnedSlotPage;
  try {
    page = await listOwnedSlots(
      deps.runtimeSlotStore,
      input,
      original.slot.state,
    );
  } catch (err) {
    recordFailure(
      deps,
      result,
      original.slot.id,
      `slot:${original.slot.id}`,
      null,
      err,
    );
    return false;
  }
  const current = page.items.find(
    (candidate) => candidate.slot.id === original.slot.id,
  );
  if (!current) return false;
  if (
    current.slot.lastTaskId !== original.slot.lastTaskId ||
    current.slot.lastAttemptN !== original.slot.lastAttemptN
  ) {
    return false;
  }
  return (
    current.slot.state === 'active' ||
    (current.slot.state === 'idle' && current.slot.expiresAtMs <= now)
  );
}

async function reapLegacyOrphanWorktrees(
  deps: RuntimeResourceReaperDeps,
  input: RuntimeResourceReaperInput,
  worktrees: WorktreeRegistry,
  retainedSessionDirs: Set<string>,
  retainedWorkspacePaths: Set<string>,
  result: RuntimeResourceReaperResult,
): Promise<void> {
  if (!input.mainWorktree) return;
  const workspaceRoot = resolve(input.mainWorktree, '.worktrees');
  if (!existsSync(workspaceRoot)) return;

  let entries: Dirent[];
  try {
    entries = readdirSync(workspaceRoot, { withFileTypes: true });
  } catch (err) {
    recordFailure(deps, result, null, workspaceRoot, workspaceRoot, err);
    return;
  }
  for (const entry of entries) {
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

    await removeWorkspace(
      deps,
      result,
      worktrees,
      input.mainWorktree,
      null,
      workspacePath,
      workspaceRoot,
      false,
    );
  }
}

async function removeWorkspace(
  deps: RuntimeResourceReaperDeps,
  result: RuntimeResourceReaperResult,
  worktrees: WorktreeRegistry,
  mainWorktree: string | null,
  slotId: string | null,
  workspacePath: string,
  workspaceRoot: string,
  scratch: boolean,
): Promise<void> {
  if (!existsSync(workspacePath)) return;
  if (!isRealPathInsideRoot(workspacePath, workspaceRoot)) {
    recordUnsafePath(deps, result, slotId, workspacePath, workspaceRoot);
    return;
  }

  if (scratch || !mainWorktree) {
    try {
      rmSync(workspacePath, { force: true, recursive: true });
      result.removedWorkspaces++;
    } catch (err) {
      recordFailure(deps, result, slotId, workspacePath, workspaceRoot, err);
    }
    return;
  }
  if (worktrees.kind === 'unavailable') {
    recordFailure(
      deps,
      result,
      slotId,
      workspacePath,
      workspaceRoot,
      new Error(worktrees.reason),
    );
    return;
  }

  try {
    const canonical = realpathSync(workspacePath);
    if (worktrees.paths.has(canonical)) {
      await execFileText('git', [
        '-C',
        mainWorktree,
        'worktree',
        'remove',
        '--force',
        workspacePath,
      ]);
      worktrees.paths.delete(canonical);
    } else {
      rmSync(workspacePath, { force: true, recursive: true });
    }
    result.removedWorkspaces++;
  } catch (err) {
    recordFailure(deps, result, slotId, workspacePath, workspaceRoot, err);
  }
}

async function listRegisteredWorktrees(
  mainWorktree: string,
): Promise<WorktreeRegistry> {
  try {
    const list = await execFileText('git', [
      '-C',
      mainWorktree,
      'worktree',
      'list',
      '--porcelain',
    ]);
    return {
      kind: 'ready',
      paths: new Set(
        list
          .split('\n')
          .filter((line) => line.startsWith('worktree '))
          .map((line) => canonicalPath(line.slice('worktree '.length))),
      ),
    };
  } catch (err) {
    return { kind: 'unavailable', reason: errorMessage(err) };
  }
}

function isRealPathInsideRoot(path: string, root: string): boolean {
  try {
    return isResolvedPathInsideRoot(realpathSync(path), realpathSync(root));
  } catch {
    return false;
  }
}

function isResolvedPathInsideRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function recordUnsafePath(
  deps: RuntimeResourceReaperDeps,
  result: RuntimeResourceReaperResult,
  slotId: string | null,
  path: string,
  root: string | null,
): void {
  const issue: RuntimeResourceReaperIssue = {
    kind: 'unsafe_path',
    path,
    reason:
      root === null
        ? 'No daemon-owned root was available for this workspace.'
        : 'Candidate or root could not be resolved inside the daemon-owned root.',
    root,
    slotId,
  };
  result.unsafePaths++;
  result.unsafePathDetails.push(issue);
  emitIssue(deps, issue);
}

function recordFailure(
  deps: RuntimeResourceReaperDeps,
  result: RuntimeResourceReaperResult,
  slotId: string | null,
  path: string,
  root: string | null,
  err: unknown,
): void {
  const issue: RuntimeResourceReaperIssue = {
    kind: 'failure',
    path,
    reason: errorMessage(err),
    root,
    slotId,
  };
  result.failed++;
  result.failures.push(issue);
  emitIssue(deps, issue);
}

function emitIssue(
  deps: RuntimeResourceReaperDeps,
  issue: RuntimeResourceReaperIssue,
): void {
  try {
    deps.onIssue?.(issue);
  } catch {
    // Logging must not turn best-effort cleanup into a daemon failure.
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      file,
      args,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(
            err instanceof Error
              ? err
              : new Error('Child process failed without an Error instance.'),
          );
        } else {
          resolvePromise(stdout);
        }
      },
    );
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += concurrency) {
    await Promise.all(items.slice(index, index + concurrency).map(worker));
  }
}
