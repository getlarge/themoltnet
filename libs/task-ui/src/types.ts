import type { ReactNode } from 'react';

export type TaskStatus =
  | 'waiting'
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type TaskAttemptStatus =
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type OutputKind = 'artifact' | 'judgment';

export type ExecutorTrustLevel =
  | 'selfDeclared'
  | 'agentSigned'
  | 'releaseVerifiedTool'
  | 'sandboxAttested';

export type TaskMessageKind =
  | 'text_delta'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'turn_end'
  | 'error'
  | 'info';

export interface TaskRef {
  taskId: string | null;
  outputCid: string;
  role: 'judged_work' | 'reviewed_diff' | 'target_source' | 'context';
  external?: {
    kind: 'github_pr' | 'github_issue' | 'http_url';
    pr?: number;
    issue?: number;
    url?: string;
    commit_sha?: string;
    snapshot_cid?: string;
  };
}

export interface TaskUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  toolCalls?: number;
  model?: string;
  provider?: string;
}

export interface TaskError {
  code: string;
  message: string;
  stack?: string;
  retryable?: boolean;
}

export type ClaimCondition =
  | {
      op: 'all';
      conditions: ClaimCondition[];
    }
  | {
      op: 'any';
      conditions: ClaimCondition[];
    }
  | {
      op: 'task_status';
      taskId: string;
      statuses: TaskStatus[];
    }
  | {
      op: 'task_accepted';
      taskId: string;
    };

export interface TaskSummary {
  id: string;
  taskType: string;
  title: string | null;
  tags: string[];
  teamId: string;
  diaryId: string | null;
  outputKind: OutputKind;
  input: Record<string, unknown>;
  inputSchemaCid: string;
  inputCid: string;
  references: TaskRef[];
  correlationId: string | null;
  proposedByAgentId: string | null;
  proposedByHumanId: string | null;
  acceptedAttemptN: number | null;
  claimCondition: ClaimCondition | null;
  requiredExecutorTrustLevel: ExecutorTrustLevel;
  allowedExecutors: { provider: string; model: string }[];
  status: TaskStatus;
  queuedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  cancelledByAgentId: string | null;
  cancelledByHumanId: string | null;
  cancelReason: string | null;
  maxAttempts: number;
  dispatchTimeoutSec: number | null;
  runningTimeoutSec: number | null;
  consoleUrl?: string;
}

export interface TaskAttemptSummary {
  taskId: string;
  attemptN: number;
  claimedByAgentId: string;
  runtimeId: string | null;
  claimedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  status: TaskAttemptStatus;
  output: Record<string, unknown> | null;
  outputCid: string | null;
  claimedExecutorFingerprint: string | null;
  claimedExecutorManifest: Record<string, unknown> | null;
  completedExecutorFingerprint: string | null;
  completedExecutorManifest: Record<string, unknown> | null;
  error: TaskError | null;
  usage: TaskUsage | null;
  contentSignature: string | null;
  signedAt: string | null;
}

export interface TaskMessage {
  taskId: string;
  attemptN: number;
  seq: number;
  timestamp: string;
  kind: TaskMessageKind;
  payload: Record<string, unknown>;
}

export interface TaskAction {
  id: string;
  label: string;
  description?: string;
  prompt?: string;
  href?: string;
  disabled?: boolean;
}

export type TaskLabelRenderer = (id: string | null) => ReactNode;

export interface TaskUiCopy {
  copiedLabel?: string;
  copyFailedLabel?: string;
}
