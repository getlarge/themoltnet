import type { Agent } from '@themoltnet/sdk';

export type SdkTask = Awaited<ReturnType<Agent['tasks']['get']>>;
export type SdkTaskAttempt = Awaited<
  ReturnType<Agent['tasks']['listAttempts']>
>[number];

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
  allowedExecutors?: Array<{ provider: string; model: string }>;
  requiredExecutorTrustLevel?:
    | 'selfDeclared'
    | 'agentSigned'
    | 'releaseVerifiedTool'
    | 'sandboxAttested';
  pollIntervalSec?: number;
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

export interface TaskClient {
  createTask(body: Parameters<Agent['tasks']['create']>[0]): Promise<SdkTask>;
  getTask(id: string): Promise<SdkTask>;
  listAttempts(id: string): Promise<SdkTaskAttempt[]>;
  listMessages?(
    id: string,
    attemptN: number,
  ): Promise<
    Array<{
      seq: number;
      kind: string;
      payload: unknown;
      timestamp?: string;
    }>
  >;
}

export interface WorkflowContext {
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleepFor(name: string, seconds: number): Promise<void>;
  awaitEvent?(
    eventName: string,
    options?: { stepName?: string; timeout?: number },
  ): Promise<unknown>;
  emitEvent?(eventName: string, payload?: unknown): Promise<void>;
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
  classification?: string;
  confidence?: string;
  allowedNextAction?: SupervisorAction;
  targetStep?: string;
  humanMessage?: string;
  risk?: string;
  evidence?: Array<Record<string, unknown>>;
}

export interface AcceptedTaskResult {
  task: SdkTask;
  attempt: SdkTaskAttempt;
  state: LifecycleStateArtifact;
}
