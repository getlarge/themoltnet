import type {
  GithubClient,
  IssueLifecycleDeps,
  PullRequestStatus,
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
} from './types.js';

export function outputState(body: Record<string, unknown>) {
  const summary = typeof body.summary === 'string' ? body.summary : 'summary';
  return {
    summary,
    artifacts: [
      {
        kind: 'issue_lifecycle_state',
        title: 'state',
        body: JSON.stringify(body),
      },
    ],
  };
}

export class FakeTasks implements TaskClient {
  readonly created: Array<Parameters<TaskClient['createTask']>[0]> = [];
  private readonly tasks = new Map<string, SdkTask>();
  private readonly attempts = new Map<string, SdkTaskAttempt>();
  private next = 1;

  constructor(private readonly outputs: Array<Record<string, unknown>>) {}

  createTask(body: Parameters<TaskClient['createTask']>[0]): Promise<SdkTask> {
    const id = `00000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`;
    this.next += 1;
    const output = this.outputs.shift();
    if (!output) throw new Error('test exhausted fake outputs');
    const task = {
      id,
      taskType: body.taskType,
      title: body.title ?? null,
      tags: [],
      teamId: body.teamId,
      diaryId: body.diaryId,
      outputKind: 'artifact',
      input: body.input,
      inputSchemaCid: 'cid',
      inputCid: 'cid',
      references: body.references ?? [],
      correlationId: body.correlationId ?? null,
      proposedByAgentId: 'agent',
      proposedByHumanId: null,
      acceptedAttemptN: 1,
      claimCondition: body.claimCondition ?? null,
      requiredExecutorTrustLevel:
        body.requiredExecutorTrustLevel ?? 'selfDeclared',
      allowedExecutors: body.allowedExecutors ?? [],
      status: 'completed',
      queuedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      expiresAt: null,
      cancelledByAgentId: null,
      cancelledByHumanId: null,
      cancelReason: null,
      maxAttempts: body.maxAttempts ?? 1,
      dispatchTimeoutSec: body.dispatchTimeoutSec ?? null,
      runningTimeoutSec: body.runningTimeoutSec ?? null,
    } as SdkTask;
    const attempt = {
      taskId: id,
      attemptN: 1,
      claimedByAgentId: 'agent',
      runtimeId: null,
      claimedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'completed',
      output: outputState(output),
      outputCid: `cid-${id}`,
      claimedExecutorFingerprint: null,
      claimedExecutorManifest: null,
      completedExecutorFingerprint: null,
      completedExecutorManifest: null,
      error: null,
      usage: null,
      contentSignature: null,
      signedAt: null,
      daemonState: {
        reportedAt: new Date().toISOString(),
        slotResumableUntil: new Date(Date.now() + 60_000).toISOString(),
      },
    } as SdkTaskAttempt;
    this.created.push(body);
    this.tasks.set(id, task);
    this.attempts.set(id, attempt);
    return Promise.resolve(task);
  }

  getTask(id: string): Promise<SdkTask> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`missing task ${id}`);
    return Promise.resolve(task);
  }

  listAttempts(id: string): Promise<SdkTaskAttempt[]> {
    const attempt = this.attempts.get(id);
    if (!attempt) throw new Error(`missing attempt ${id}`);
    return Promise.resolve([attempt]);
  }
}

export class FakeGithub implements GithubClient {
  approval = true;
  skipNotify = false;
  approvalResponses: boolean[] = [];
  comments: Array<{ id: number; body: string }> = [];
  labels: Array<{ issueNumber: number; label: string }> = [];
  prResponses: PullRequestStatus[] = [];
  prPolls = 0;
  prStatus: PullRequestStatus = {
    number: 42,
    url: 'https://github.com/getlarge/themoltnet/pull/42',
    merged: false,
    checks: 'success',
  };

  getIssue() {
    return Promise.resolve({
      number: 1327,
      title: 'Build lifecycle app',
      body: 'body',
      labels: [],
    });
  }

  listIssueComments() {
    return Promise.resolve(this.comments);
  }

  createIssueComment(_repo: string, _issueNumber: number, body: string) {
    this.comments.push({ id: this.comments.length + 1, body });
    return Promise.resolve();
  }

  updateIssueComment(_repo: string, commentId: number, body: string) {
    const comment = this.comments.find(
      (candidate) => candidate.id === commentId,
    );
    if (!comment) throw new Error(`missing comment ${commentId}`);
    comment.body = body;
    return Promise.resolve();
  }

  addIssueLabel(_repo: string, issueNumber: number, label: string) {
    this.labels.push({ issueNumber, label });
    return Promise.resolve();
  }

  hasIssueLabel(_repo: string, _issueNumber: number, label: string) {
    if (label === 'moltnet:skip-notify') {
      return Promise.resolve(this.skipNotify);
    }
    const next = this.approvalResponses.shift();
    return Promise.resolve(next ?? this.approval);
  }

  getPullRequest() {
    const next = this.prResponses.shift();
    if (next) return Promise.resolve(next);
    this.prPolls += 1;
    return Promise.resolve({
      ...this.prStatus,
      merged: this.prPolls >= 3,
    });
  }
}

export function fakeDeps(outputs: Array<Record<string, unknown>>): {
  deps: IssueLifecycleDeps;
  tasks: FakeTasks;
  github: FakeGithub;
} {
  const tasks = new FakeTasks(outputs);
  const github = new FakeGithub();
  return { deps: { tasks, github }, tasks, github };
}
