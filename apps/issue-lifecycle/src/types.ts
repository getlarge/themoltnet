import type {
  AcceptedTaskResult as OrchAcceptedTaskResult,
  TaskClient,
} from '@moltnet/orchestration';

import type { LifecycleConfig } from './lifecycle-config.js';

export type {
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
  WorkflowContext,
} from '@moltnet/orchestration';

export type LifecyclePhase =
  | 'triaging'
  | 'classified'
  | 'plan_generated'
  | 'approved'
  | 'implementing'
  | 'pr_open'
  | 'pr_failed'
  | 'pr_review'
  | 'lifecycle_recommendation'
  | 'notify'
  | 'done';

export type SupervisorAction =
  | 'continue'
  | 'retry_step'
  | 'spawn_replacement_step'
  | 'revise_plan'
  | 'resolve_review_findings'
  | 'wait_for_human'
  | 'stop_blocked'
  | 'abort';

export interface IssueLifecycleInput {
  repo: string;
  issueNumber: number;
  teamId: string;
  diaryId: string;
  correlationId?: string;
  consoleUrl?: string;
  approvalLabel?: string;
  readyForReviewLabel?: string;
  skipNotifyLabel?: string;
  /**
   * Per-step runtime profile + task-attempt config. Pins which MoltNet runtime
   * profile (provider/model/sandbox) each lifecycle step may run on (enforced
   * via the task `allowedProfiles` allowlist) and the per-task `maxAttempts`.
   * Loaded and validated from an external JSON file; empty = built-in defaults.
   */
  lifecycleConfig?: LifecycleConfig;
  requiredExecutorTrustLevel?:
    | 'selfDeclared'
    | 'agentSigned'
    | 'releaseVerifiedTool'
    | 'sandboxAttested';
  pollIntervalSec?: number;
  maxPrPendingPolls?: number;
  maxReviewRounds?: number;
  maxImplementationRetries?: number;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface PullRequestStatus {
  number: number;
  url: string;
  merged: boolean;
  checks: 'pending' | 'success' | 'failure';
}

export interface GithubIssueComment {
  id: number;
  body: string;
}

export interface GithubClient {
  getIssue(repo: string, issueNumber: number): Promise<GithubIssue>;
  listIssueComments(
    repo: string,
    issueNumber: number,
  ): Promise<GithubIssueComment[]>;
  createIssueComment(
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<void>;
  updateIssueComment(
    repo: string,
    commentId: number,
    body: string,
  ): Promise<void>;
  addIssueLabel(
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<void>;
  hasIssueLabel(
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<boolean>;
  getPullRequest(repo: string, prNumber: number): Promise<PullRequestStatus>;
}

export interface IssueLifecycleDeps {
  tasks: TaskClient;
  github: GithubClient;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface LifecycleStateArtifact {
  phase: LifecyclePhase;
  decision: string;
  summary: string;
  findings?: string[];
  plan?: string;
  reviewedPlanSummary?: string;
  prNumber?: number;
  prUrl?: string;
  notifySkipped?: boolean;
  prReviewKind?: string;
  prReviewCommentUrl?: string;
  prReviewCommentBody?: string;
  resolvedFindings?: string[];
  ignoredFindings?: string[];
  reflectionEntryId?: string;
  linkedEntryIds?: string[];
  prReflectionUrl?: string;
  classification?: string;
  confidence?: string;
  allowedNextAction?: SupervisorAction;
  targetStep?: string;
  humanMessage?: string;
  risk?: string;
  evidence?: Array<Record<string, unknown>>;
}

/** Accepted-task result specialized to the lifecycle state artifact. */
export type AcceptedTaskResult = OrchAcceptedTaskResult<LifecycleStateArtifact>;
