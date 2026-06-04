import type {
  Task as DbTask,
  TaskAttempt as DbTaskAttempt,
  TaskMessage as DbTaskMessage,
} from '@moltnet/database';
import type {
  ClaimCondition,
  ExecutorTrustLevel as WireExecutorTrustLevel,
  Task,
  TaskAttempt,
  TaskError,
  TaskMessage,
  TaskUsage,
} from '@moltnet/tasks';

export const TRUST_LEVEL_TO_WIRE = {
  self_declared: 'selfDeclared',
  agent_signed: 'agentSigned',
  release_verified_tool: 'releaseVerifiedTool',
  sandbox_attested: 'sandboxAttested',
} as const satisfies Record<
  DbTask['requiredExecutorTrustLevel'],
  WireExecutorTrustLevel
>;

export function dbTaskToWire(row: DbTask): Task {
  return {
    id: row.id,
    taskType: row.taskType,
    title: row.title ?? null,
    tags: row.tags ?? [],
    teamId: row.teamId,
    diaryId: row.diaryId ?? null,
    outputKind: row.outputKind,
    input: row.input as Record<string, unknown>,
    inputSchemaCid: row.inputSchemaCid,
    inputCid: row.inputCid,
    references: row.taskRefs as unknown[] as Task['references'],
    correlationId: row.correlationId ?? null,
    proposedByAgentId: row.proposedByAgentId ?? null,
    proposedByHumanId: row.proposedByHumanId ?? null,
    acceptedAttemptN: row.acceptedAttemptN ?? null,
    claimCondition: (row.claimCondition as ClaimCondition | null) ?? null,
    requiredExecutorTrustLevel:
      TRUST_LEVEL_TO_WIRE[row.requiredExecutorTrustLevel],
    allowedExecutors: row.allowedExecutors as Task['allowedExecutors'],
    status: row.status,
    queuedAt: row.queuedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    cancelledByAgentId: row.cancelledByAgentId ?? null,
    cancelledByHumanId: row.cancelledByHumanId ?? null,
    cancelReason: row.cancelReason ?? null,
    maxAttempts: row.maxAttempts,
    dispatchTimeoutSec: row.dispatchTimeoutSec ?? null,
    runningTimeoutSec: row.runningTimeoutSec ?? null,
  };
}

export function dbAttemptToWire(
  row: DbTaskAttempt & {
    claimedExecutorManifest?: unknown;
    completedExecutorManifest?: unknown;
    daemonState?: unknown;
  },
): TaskAttempt {
  return {
    taskId: row.taskId,
    attemptN: row.attemptN,
    claimedByAgentId: row.claimedByAgentId,
    runtimeId: row.runtimeId ?? null,
    claimedAt: row.claimedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    status: row.status,
    output: (row.output as Record<string, unknown>) ?? null,
    outputCid: row.outputCid ?? null,
    claimedExecutorFingerprint: row.claimedExecutorFingerprint ?? null,
    claimedExecutorManifest:
      (row.claimedExecutorManifest as Record<string, unknown> | null) ?? null,
    completedExecutorFingerprint: row.completedExecutorFingerprint ?? null,
    completedExecutorManifest:
      (row.completedExecutorManifest as Record<string, unknown> | null) ?? null,
    error: (row.error as TaskError) ?? null,
    usage: (row.usage as TaskUsage) ?? null,
    contentSignature: row.contentSignature ?? null,
    signedAt: row.signedAt?.toISOString() ?? null,
    daemonState: (row.daemonState as TaskAttempt['daemonState']) ?? null,
  };
}

export function dbMessageToWire(row: DbTaskMessage): TaskMessage {
  return {
    taskId: row.taskId,
    attemptN: row.attemptN,
    seq: Number(row.seq),
    timestamp: row.timestamp.toISOString(),
    kind: row.kind,
    payload: row.payload as Record<string, unknown>,
  };
}
