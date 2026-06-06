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
  | 'releasing'
  | 'notify'
  | 'done';

export interface IssueLifecycleInput {
  repo: string;
  issueNumber: number;
  teamId: string;
  diaryId: string;
  correlationId?: string;
  approvalLabel?: string;
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

export interface GithubClient {
  getIssue(repo: string, issueNumber: number): Promise<GithubIssue>;
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
}

export interface WorkflowContext {
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleepFor(name: string, seconds: number): Promise<void>;
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
  prNumber?: number;
  prUrl?: string;
  notifySkipped?: boolean;
}

export interface AcceptedTaskResult {
  task: SdkTask;
  attempt: SdkTaskAttempt;
  state: LifecycleStateArtifact;
}
