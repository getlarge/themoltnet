import type { RuntimeProfileWorkspaceMode } from '@moltnet/runtime-profiles';
import { getTaskExecutionPolicy } from '@moltnet/tasks';
import type { ClaimedTask } from '@themoltnet/agent-runtime';

import type { DaemonSlotIdentity } from './daemon-slot-identity.js';
import { slugifyAsciiLower } from './slugify.js';

export interface DaemonTaskExecutionPlan {
  workspaceMode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  slotKey: string | null;
  slotId: string | null;
  workspaceId: string | null;
  worktreeBranch: string | null;
  workspaceRevision?: string | null;
  /**
   * Base ref a NEW `worktreeBranch` is cut from (fork continuations branch from
   * the parent tip). Ignored when the branch already exists.
   */
  worktreeBaseRef?: string | null;
  /**
   * Lifecycle kind for the recorded workspace: 'origin' (default worktree),
   * 'fork' (diverged branch), or 'scratch' (copied scratch dir).
   */
  workspaceKind?: 'origin' | 'fork' | 'scratch';
  sessionKey: string | null;
  workspaceScope: 'attempt' | 'session';
  workspaceAttachment?: {
    mountPath: string;
    cwdPath: string;
    shadowWrites?: 'deny' | 'tmpfs';
  } | null;
  workspaceSeed?: {
    copyFromPath: string;
    source: 'producer';
  } | null;
}

export class WorkspaceModeMismatchError extends Error {}

export interface RuntimeProfileWorkspacePolicy {
  workspaceExplicit?: boolean;
  profileName?: string;
  defaultWorkspaceMode?: RuntimeProfileWorkspaceMode | null;
  allowedWorkspaceModes?: readonly RuntimeProfileWorkspaceMode[];
}

export function buildDaemonTaskExecutionPlan(
  task: Pick<
    ClaimedTask['task'],
    'id' | 'taskType' | 'title' | 'correlationId' | 'input'
  >,
  runtimeProfileWorkspacePolicy: RuntimeProfileWorkspacePolicy = {},
  attemptN?: number,
): DaemonTaskExecutionPlan {
  const workspaceMode = resolveTaskWorkspaceMode(
    task,
    getTaskExecutionPolicy(task.taskType),
    runtimeProfileWorkspacePolicy,
  );
  const slotKey = null;
  const slotId = null;
  const workspaceScope = 'attempt' as const;
  const worktreeBranch = resolveTaskWorktreeBranch(task, workspaceMode);
  const workspaceRevision = resolveTaskWorkspaceRevision(task.input);
  const workspaceId =
    workspaceMode === 'shared_mount'
      ? null
      : attemptN
        ? `daemon-task-${task.id}-attempt-${attemptN}`
        : `task-${task.id}`;

  return {
    workspaceMode,
    workspaceKind: workspaceMode === 'scratch_mount' ? 'scratch' : undefined,
    sessionKey: slotId,
    slotKey,
    slotId,
    workspaceScope,
    workspaceId,
    worktreeBranch,
    workspaceRevision,
  };
}

export function resolveTaskWorkspaceRevision(input: unknown): string | null {
  const value = (input as { execution?: { revision?: unknown } } | null)
    ?.execution?.revision;
  return typeof value === 'string' && /^[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

export function buildDaemonSlotId(
  identity: DaemonSlotIdentity,
  slotKey: string,
): string {
  return [
    'agent',
    slugSlotIdentityComponent(identity.agentName),
    'profile',
    slugSlotIdentityComponent(identity.runtimeProfileId),
    'key',
    slotKey,
  ].join(':');
}

export function buildRuntimeSlotKey(
  logicalSessionKey: string,
  runtimeInstanceId: string | undefined,
): string {
  return runtimeInstanceId
    ? `${logicalSessionKey}:worker:${slugSlotIdentityComponent(runtimeInstanceId)}`
    : logicalSessionKey;
}

export function runtimeSlotKeyBelongsToInstance(
  slotKey: string,
  runtimeInstanceId: string,
): boolean {
  return slotKey.endsWith(
    `:worker:${slugSlotIdentityComponent(runtimeInstanceId)}`,
  );
}

function slugSlotIdentityComponent(input: string): string {
  return slugifyAsciiLower(input.trim(), 64, ['.', '_', '-']);
}

function resolveTaskWorktreeBranch(
  task: Pick<
    ClaimedTask['task'],
    'taskType' | 'title' | 'correlationId' | 'id' | 'input'
  >,
  workspaceMode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount',
): string | null {
  if (workspaceMode !== 'dedicated_worktree') {
    return null;
  }
  const revision = (task.input as { execution?: { revision?: unknown } })
    .execution?.revision;
  if (typeof revision === 'string') {
    return null;
  }

  if (task.taskType === 'fulfill_brief') {
    const input = task.input as {
      brief?: unknown;
      scopeHint?: unknown;
    };
    const title =
      typeof task.title === 'string' && task.title.trim().length > 0
        ? task.title
        : typeof input.brief === 'string' && input.brief.trim().length > 0
          ? input.brief
          : task.taskType;
    const slug = slugifyAsciiLower(title, 60) || 'task';

    if (task.correlationId) {
      return `moltnet/${task.correlationId}/${slug}`;
    }

    const scopeHint =
      typeof input.scopeHint === 'string' && input.scopeHint.trim().length > 0
        ? slugifyAsciiLower(input.scopeHint, 60)
        : 'task';
    return `feat/${scopeHint || 'task'}-${slug}`;
  }

  return `task/${slugifyAsciiLower(task.taskType, 60) || 'task'}-${task.id.slice(0, 8)}`;
}

function resolveTaskWorkspaceMode(
  task: Pick<ClaimedTask['task'], 'taskType' | 'input'>,
  policy: {
    workspaceMode: 'shared_mount' | 'dedicated_worktree';
    acceptsInputWorkspaceOverride: boolean;
  },
  runtimeProfileWorkspacePolicy: RuntimeProfileWorkspacePolicy,
): 'shared_mount' | 'dedicated_worktree' | 'scratch_mount' {
  const allowed = resolveAllowedWorkspaceModes(runtimeProfileWorkspacePolicy);
  const profileDefault =
    runtimeProfileWorkspacePolicy.defaultWorkspaceMode ?? null;

  const requestedWorkspace =
    policy.acceptsInputWorkspaceOverride &&
    typeof (task.input as { execution?: { workspace?: unknown } }).execution
      ?.workspace === 'string'
      ? (task.input as { execution: { workspace: string } }).execution.workspace
      : null;

  if (isRuntimeProfileWorkspaceMode(requestedWorkspace)) {
    if (allowed.has(requestedWorkspace))
      return toDaemonWorkspaceMode(requestedWorkspace);
    if (runtimeProfileWorkspacePolicy.workspaceExplicit)
      throw new WorkspaceModeMismatchError(
        `Requested workspace mode ${requestedWorkspace} is not allowed by profile ${runtimeProfileWorkspacePolicy.profileName ?? '(selected)'}; allowed: ${[...allowed].join(', ')}`,
      );
  }

  if (profileDefault && allowed.has(profileDefault)) {
    return toDaemonWorkspaceMode(profileDefault);
  }

  if (allowed.has(policy.workspaceMode)) {
    return policy.workspaceMode;
  }

  return toDaemonWorkspaceMode(firstAllowedWorkspaceMode(allowed));
}

const ALL_WORKSPACE_MODES: readonly RuntimeProfileWorkspaceMode[] = [
  'none',
  'shared_mount',
  'dedicated_worktree',
];
const WORKSPACE_MODE_FALLBACK_ORDER: readonly RuntimeProfileWorkspaceMode[] = [
  'none',
  'dedicated_worktree',
  'shared_mount',
];

function resolveAllowedWorkspaceModes(
  policy: RuntimeProfileWorkspacePolicy,
): Set<RuntimeProfileWorkspaceMode> {
  const modes =
    policy.allowedWorkspaceModes && policy.allowedWorkspaceModes.length > 0
      ? policy.allowedWorkspaceModes
      : ALL_WORKSPACE_MODES;
  return new Set(
    modes.filter((mode): mode is RuntimeProfileWorkspaceMode =>
      isRuntimeProfileWorkspaceMode(mode),
    ),
  );
}

function firstAllowedWorkspaceMode(
  allowed: Set<RuntimeProfileWorkspaceMode>,
): RuntimeProfileWorkspaceMode {
  for (const mode of WORKSPACE_MODE_FALLBACK_ORDER) {
    if (allowed.has(mode)) return mode;
  }
  return 'none';
}

function isRuntimeProfileWorkspaceMode(
  value: unknown,
): value is RuntimeProfileWorkspaceMode {
  return (
    value === 'none' ||
    value === 'shared_mount' ||
    value === 'dedicated_worktree'
  );
}

function toDaemonWorkspaceMode(
  mode: RuntimeProfileWorkspaceMode,
): 'shared_mount' | 'dedicated_worktree' | 'scratch_mount' {
  return mode === 'none' ? 'scratch_mount' : mode;
}
