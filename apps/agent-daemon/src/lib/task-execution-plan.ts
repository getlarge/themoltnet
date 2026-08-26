import { createHash } from 'node:crypto';

import type { RuntimeProfileWorkspaceMode } from '@moltnet/runtime-profiles';
import type { ClaimedTask } from '@themoltnet/agent-runtime';

import type { DaemonSlotIdentity } from './daemon-slot-identity.js';
import {
  deriveTaskSessionDescriptor,
  type TaskSessionDescriptor,
} from './session-policy.js';
import { slugifyAsciiLower } from './slugify.js';
import type { DaemonStateDirs } from './state-dir.js';

export interface DaemonTaskExecutionPlan {
  descriptor: TaskSessionDescriptor;
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
  sessionPersistence?: {
    sessionDir: string;
    forkFromSessionPath?: string | null;
  } | null;
}

export interface RuntimeProfileWorkspacePolicy {
  defaultWorkspaceMode?: RuntimeProfileWorkspaceMode | null;
  allowedWorkspaceModes?: readonly RuntimeProfileWorkspaceMode[];
}

export function buildDaemonTaskExecutionPlan(
  task: Pick<
    ClaimedTask['task'],
    'id' | 'taskType' | 'title' | 'correlationId' | 'input'
  >,
  stateDirs: DaemonStateDirs,
  identity: DaemonSlotIdentity,
  warmSessionTtlSec: number,
  runtimeProfileWorkspacePolicy: RuntimeProfileWorkspacePolicy = {},
  attemptN?: number,
): DaemonTaskExecutionPlan {
  const descriptor = deriveTaskSessionDescriptor(task);
  const workspaceMode = resolveTaskWorkspaceMode(
    task,
    descriptor.policy,
    runtimeProfileWorkspacePolicy,
  );
  const slotKey =
    warmSessionTtlSec > 0 && descriptor.sessionKey
      ? buildRuntimeSlotKey(descriptor.sessionKey, identity.runtimeInstanceId)
      : null;
  const workspaceScope =
    slotKey !== null ? descriptor.policy.workspaceScope : 'attempt';
  const slotId = slotKey ? buildDaemonSlotId(identity, slotKey) : null;
  const sessionDir = slotId
    ? `${stateDirs.piSessionsDir}/${boundedKeyDirComponent(slotId)}`
    : null;
  const worktreeBranch = resolveTaskWorktreeBranch(task, workspaceMode);
  const workspaceRevision = resolveTaskWorkspaceRevision(task.input);
  const workspaceId =
    workspaceMode !== 'shared_mount'
      ? resolveTaskWorkspaceId(task, {
          sessionKey: slotId,
          workspaceScope,
          sessionPersistence: sessionDir ? { sessionDir } : null,
          attemptN,
        })
      : null;

  return {
    descriptor,
    workspaceMode,
    workspaceKind: workspaceMode === 'scratch_mount' ? 'scratch' : undefined,
    sessionKey: slotId,
    slotKey,
    slotId,
    workspaceScope,
    sessionPersistence: sessionDir ? { sessionDir } : null,
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

function buildRuntimeSlotKey(
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
    if (allowed.has(requestedWorkspace)) {
      return toDaemonWorkspaceMode(requestedWorkspace);
    }
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

/**
 * URL-encode a slot/session key for use as a single filesystem directory
 * component, bounded to stay under the 255-byte per-component filename limit.
 * A long key (e.g. `run_eval`'s custom key, which embeds the variant label +
 * agent name + worker id) otherwise crashes `mkdir` with `ENAMETOOLONG`.
 *
 * Additive by design: keys short enough today keep their exact encoded form (so
 * existing warm dirs are byte-identical), and only over-long keys get a readable
 * prefix + a collision-resistant sha256 suffix. The component is never decoded
 * back to the key anywhere, so hashing the tail is safe. Used for BOTH the
 * pi-sessions dir and the session workspace dir so the two names derive
 * consistently from the same slot id.
 */
function boundedKeyDirComponent(key: string): string {
  const encoded = encodeURIComponent(key);
  // A parent may add a short prefix (`session-` = 8); 200 leaves margin < 255.
  if (encoded.length <= 200) {
    return encoded;
  }
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return `${encoded.slice(0, 180)}-${hash}`;
}

function resolveTaskWorkspaceId(
  task: Pick<ClaimedTask['task'], 'id'>,
  executionPlan: {
    sessionKey: string | null;
    workspaceScope: 'attempt' | 'session';
    sessionPersistence?: { sessionDir: string } | null;
    attemptN?: number;
  },
): string {
  if (
    executionPlan.workspaceScope === 'session' &&
    executionPlan.sessionKey !== null
  ) {
    return `session-${boundedKeyDirComponent(executionPlan.sessionKey)}`;
  }
  return executionPlan.attemptN
    ? `daemon-task-${task.id}-attempt-${executionPlan.attemptN}`
    : `task-${task.id}`;
}
