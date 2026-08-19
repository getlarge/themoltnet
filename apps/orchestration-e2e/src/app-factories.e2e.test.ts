import {
  createIssueLifecycleAbsurdApp,
  GITHUB_ISSUE_LIFECYCLE_TASK,
  type GithubClient,
} from '@themoltnet/issue-lifecycle';
import {
  createMultiLensReviewAbsurdApp,
  MULTI_LENS_REVIEW_TASK,
  type MultiLensReviewDeps,
  type MultiLensReviewInput,
  type ReviewManifest,
} from '@themoltnet/multi-lens-review';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it } from 'vitest';

const ABSURD_URL = process.env.ORCHESTRATION_ABSURD_URL as string;

function issueOutput(body: Record<string, unknown>) {
  return {
    summary: typeof body.summary === 'string' ? body.summary : 'summary',
    artifacts: [
      {
        kind: 'issue_lifecycle_state',
        title: 'state',
        body: JSON.stringify(body),
      },
    ],
  };
}

function successfulIssueOutput(body: Parameters<FakeTasks['createTask']>[0]) {
  if (body.title?.startsWith('Triage issue')) {
    return { phase: 'classified', decision: 'plan', summary: 'classified' };
  }
  if (body.title?.startsWith('Plan issue')) {
    return {
      phase: 'plan_generated',
      decision: 'ready_for_review',
      summary: 'planned',
      plan: 'plan',
    };
  }
  if (body.title?.startsWith('Review plan')) {
    return {
      phase: 'plan_generated',
      decision: 'review_passed',
      summary: 'reviewed',
      findings: [],
    };
  }
  if (body.title?.startsWith('Implement issue')) {
    return {
      phase: 'pr_open',
      decision: 'link_pr',
      summary: 'implemented',
      prNumber: 42,
      prUrl: 'https://github.com/getlarge/themoltnet/pull/42',
    };
  }
  const reviewKind = (['complexity', 'functional', 'security'] as const).find(
    (kind) => body.title?.toLowerCase().includes(kind),
  );
  if (reviewKind) {
    return {
      phase: 'pr_review',
      decision: 'review_passed',
      summary: `${reviewKind} ok`,
      prReviewKind: reviewKind,
      findings: [],
      prReviewCommentUrl: `https://github.com/getlarge/themoltnet/pull/42#${reviewKind}`,
      prReviewCommentBody: `${reviewKind} ok`,
      noImplementationPerformed: true,
    };
  }
  if (body.title?.startsWith('Apply PR review feedback')) {
    return {
      phase: 'pr_open',
      decision: 'link_pr',
      summary: 'review feedback checked',
      prNumber: 42,
      prUrl: 'https://github.com/getlarge/themoltnet/pull/42',
      resolvedFindings: [],
      ignoredFindings: [],
      changedFiles: [],
      testsRun: [],
      diaryEntryIds: ['entry-implementation'],
    };
  }
  if (body.title?.startsWith('Notify issue')) {
    return {
      phase: 'done',
      decision: 'notify',
      summary: 'notified',
      notifySkipped: false,
      reflectionEntryId: 'entry-reflection',
      linkedEntryIds: ['entry-implementation'],
      prReflectionUrl:
        'https://github.com/getlarge/themoltnet/pull/42#issuecomment-1',
    };
  }
  throw new Error(`unexpected Issue Lifecycle task: ${body.title ?? '<none>'}`);
}

class SuccessfulGithub implements GithubClient {
  private readonly comments: Array<{ id: number; body: string }> = [];
  private approvalChecks = 0;
  private pullRequestChecks = 0;

  getIssue(_repo: string, issueNumber: number) {
    return Promise.resolve({
      number: issueNumber,
      title: 'Harden durable workflows',
      body: 'Exercise the real Absurd app factory.',
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

  addIssueLabel() {
    return Promise.resolve();
  }

  hasIssueLabel(_repo: string, _issueNumber: number, label: string) {
    if (label === 'moltnet:skip-notify') return Promise.resolve(false);
    this.approvalChecks += 1;
    return Promise.resolve(this.approvalChecks > 1);
  }

  getPullRequest(_repo: string, prNumber: number) {
    this.pullRequestChecks += 1;
    return Promise.resolve({
      number: prNumber,
      url: `https://github.com/getlarge/themoltnet/pull/${prNumber}`,
      merged: this.pullRequestChecks > 1,
      checks: 'success' as const,
    });
  }
}

function reviewManifest(): ReviewManifest {
  return {
    version: 1,
    rawDiffBytes: 4,
    totalFiles: 1,
    reviewableFiles: 1,
    reviewableBytes: 4,
    changedLoc: 2,
    requiresPlanning: false,
    files: [
      {
        path: 'src/change.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        changedLoc: 2,
        byteSize: 4,
        patchSha256:
          '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
        language: 'typescript',
        binary: false,
        generated: false,
        generatedSignals: [],
        reviewable: true,
        requiredLanes: ['correctness', 'dry-codebase-fit'],
      },
    ],
    coverage: {
      reviewableFiles: ['src/change.ts'],
      excludedFiles: [],
      primaryOwners: { 'src/change.ts': null },
      laneCoverage: { 'src/change.ts': [] },
      complete: false,
    },
    manifestArtifact: {
      cid: 'bafkrei-manifest',
      title: 'review-manifest.v1.json',
      contentType: 'application/vnd.themoltnet.review-manifest+json;version=1',
      sizeBytes: 100,
    },
  };
}

function multiLensDeps(tasks: FakeTasks): MultiLensReviewDeps {
  let staged = 0;
  return {
    tasks,
    patches: {
      read: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])),
    },
    artifacts: {
      stage: (bytes, metadata) => {
        staged += 1;
        return Promise.resolve({
          cid: `bafkrei-staged-${staged}`,
          contentType: metadata.contentType,
          sizeBytes: bytes.byteLength,
        });
      },
      download: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])),
    },
  };
}

describe('real orchestration app factories', () => {
  it('executes Issue Lifecycle through its registered Absurd task', async () => {
    const queueName = `issue-lifecycle-factory-${process.pid}-${Date.now()}`;
    const tasks = new FakeTasks(successfulIssueOutput, {
      wrapOutput: issueOutput,
    });
    const app = createIssueLifecycleAbsurdApp({
      databaseUrl: ABSURD_URL,
      queueName,
      deps: { tasks, github: new SuccessfulGithub() },
    });
    let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
    try {
      await app.createQueue(queueName);
      const spawned = await app.spawn(
        GITHUB_ISSUE_LIFECYCLE_TASK,
        {
          repo: 'getlarge/themoltnet',
          issueNumber: 1327,
          teamId: 'team',
          diaryId: 'diary',
          correlationId: 'factory-issue-lifecycle',
          pollIntervalSec: 1,
        },
        { queue: queueName },
      );
      worker = await app.startWorker({ concurrency: 1, claimTimeout: 10 });
      const result = await app.awaitTaskResult(spawned.taskID, { timeout: 45 });

      expect(result).toMatchObject({
        state: 'completed',
        result: { status: 'done', prNumber: 42 },
      });
      expect(tasks.creationOptions).toHaveLength(9);
      expect(
        new Set(tasks.creationOptions.map((options) => options?.idempotencyKey))
          .size,
      ).toBe(9);
      expect(
        tasks.creationOptions.every((options) =>
          options?.idempotencyKey?.startsWith('absurd:'),
        ),
      ).toBe(true);
    } finally {
      await worker?.close();
      await app.dropQueue(queueName).catch(() => undefined);
      await app.close();
    }
  }, 60_000);

  it('executes Multi-Lens Review through its registered Absurd task', async () => {
    const queueName = `multi-lens-factory-${process.pid}-${Date.now()}`;
    const topic = {
      version: 1,
      topicId: 'change',
      laneResults: ['correctness', 'dry-codebase-fit'].map((lane) => ({
        version: 1,
        topicId: 'change',
        lane,
        findings: [],
        reviewedFiles: ['src/change.ts'],
        summary: 'Clean.',
      })),
    };
    const tasks = new FakeTasks([
      {
        summary: JSON.stringify({
          verdict: 'PROCEED',
          summary: 'Proceed with the review.',
        }),
      },
      { summary: JSON.stringify(topic) },
      {
        summary: JSON.stringify({
          version: 1,
          recommendation: 'approve',
          findings: [],
          summary: 'All topics clean.',
          coverageComplete: true,
        }),
      },
    ]);
    const app = createMultiLensReviewAbsurdApp({
      databaseUrl: ABSURD_URL,
      queueName,
      deps: multiLensDeps(tasks),
    });
    const input: MultiLensReviewInput = {
      teamId: 'team',
      diaryId: 'diary',
      correlationId: 'factory-multi-lens',
      target: 'pull request',
      reviewBaseRevision: 'b'.repeat(40),
      reviewRevision: 'a'.repeat(40),
      reviewManifest: reviewManifest(),
      pollIntervalSec: 1,
    };
    let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
    try {
      await app.createQueue(queueName);
      const spawned = await app.spawn(MULTI_LENS_REVIEW_TASK, input, {
        queue: queueName,
      });
      worker = await app.startWorker({ concurrency: 1, claimTimeout: 10 });
      const result = await app.awaitTaskResult(spawned.taskID, { timeout: 45 });

      expect(result).toMatchObject({
        state: 'completed',
        result: { correlationId: input.correlationId, outcome: 'completed' },
      });
      expect(tasks.creationOptions).toHaveLength(3);
      expect(
        new Set(tasks.creationOptions.map((options) => options?.idempotencyKey))
          .size,
      ).toBe(3);
      expect(
        tasks.creationOptions.every((options) =>
          options?.idempotencyKey?.startsWith('absurd:'),
        ),
      ).toBe(true);
    } finally {
      await worker?.close();
      await app.dropQueue(queueName).catch(() => undefined);
      await app.close();
    }
  }, 60_000);
});
