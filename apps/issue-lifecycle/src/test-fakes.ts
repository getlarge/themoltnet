import {
  type FakeTaskOutput,
  FakeTasks,
} from '@themoltnet/tasks-orchestrator/testing';

import type {
  GithubClient,
  IssueLifecycleDeps,
  PullRequestStatus,
} from './types.js';

export type { FakeTaskOutput } from '@themoltnet/tasks-orchestrator/testing';
export { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';

/**
 * Wrap a plain lifecycle state body into the freeform artifact envelope the
 * lifecycle artifact parser reads (`kind: 'issue_lifecycle_state'`).
 */
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

export function fakeDeps(outputs: FakeTaskOutput[]): {
  deps: IssueLifecycleDeps;
  tasks: FakeTasks;
  github: FakeGithub;
} {
  const tasks = new FakeTasks(outputs, { wrapOutput: outputState });
  const github = new FakeGithub();
  return { deps: { tasks, github }, tasks, github };
}
