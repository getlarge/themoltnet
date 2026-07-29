import type {
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
  WorkflowContext,
} from '@themoltnet/tasks-orchestrator';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it, vi } from 'vitest';

import { reviewManifest } from './test-fixtures.js';
import type { ReviewArtifactStore, ReviewLane, ReviewTopic } from './types.js';
import { runMultiLensReview } from './workflow.js';

function fakeId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function summary(value: unknown) {
  return { summary: JSON.stringify(value) };
}

function plannerSummary(value: unknown) {
  const body = JSON.stringify(value);
  return {
    summary: body,
    artifacts: [
      {
        kind: 'review-topic-plan',
        title: 'review-topic-plan.v1.json',
        cid: 'bafkrei-planner-output',
        contentType:
          'application/vnd.themoltnet.review-topic-plan+json;version=1',
        sizeBytes: Buffer.byteLength(body),
      },
    ],
  };
}

function preflight(
  verdict: 'PROCEED' | 'PIVOT' | 'ASK' = 'PROCEED',
  excludedFiles: Array<{
    path: string;
    reason: string;
    evidence: string;
  }> = [],
) {
  return summary({
    verdict,
    summary: `${verdict} summary`,
    ...(verdict === 'ASK' ? { questions: ['What is the contract?'] } : {}),
    excludedFiles,
  });
}

function lane(
  topicId: string,
  reviewLane: ReviewLane,
  files = ['src/change.ts'],
) {
  return summary({
    version: 1,
    topicId,
    lane: reviewLane,
    findings: [],
    reviewedFiles: files,
    summary: 'Clean.',
  });
}

function topicVerdict(topic: ReviewTopic) {
  return summary({
    version: 1,
    topicId: topic.id,
    recommendation: 'approve',
    findings: [],
    coveredFiles: topic.primaryFiles,
    coveredLanes: topic.lanes,
    summary: 'Topic clean.',
  });
}

function globalVerdict(coverageComplete = true) {
  return summary({
    version: 1,
    recommendation: 'approve',
    findings: [],
    summary: 'All topics clean.',
    coverageComplete,
  });
}

function deterministicTopic(): ReviewTopic {
  return {
    id: 'change',
    title: 'Change under review',
    primaryFiles: ['src/change.ts'],
    lanes: ['correctness', 'dry-codebase-fit'],
  };
}

function artifactStore(
  fileBytes = 64,
  plannerOutput?: unknown,
): ReviewArtifactStore & {
  staged: Uint8Array[];
} {
  const staged: Uint8Array[] = [];
  return {
    staged,
    download: vi.fn((_taskId, cid) =>
      Promise.resolve(
        cid === 'bafkrei-planner-output'
          ? new TextEncoder().encode(JSON.stringify(plannerOutput))
          : new Uint8Array(fileBytes),
      ),
    ),
    stage: vi.fn((bytes: Uint8Array) => {
      staged.push(bytes);
      return Promise.resolve({
        cid: `bafkrei-topic-${staged.length}`,
        contentType: 'application/vnd.themoltnet.review-topic+diff;version=1',
        sizeBytes: bytes.byteLength,
      });
    }),
  };
}

function input(
  options: { requiresPlanning?: boolean } = {},
  paths = ['src/change.ts'],
) {
  return {
    teamId: 'team',
    diaryId: 'diary',
    correlationId: 'correlation',
    target: 'pull request',
    reviewManifest: reviewManifest(paths, options),
    pollIntervalSec: 1,
  };
}

describe('runMultiLensReview', () => {
  it('uses one deterministic topic and binds specialists only to its bounded CID', async () => {
    const topic = deterministicTopic();
    const tasks = new FakeTasks([
      preflight(),
      lane(topic.id, 'correctness'),
      lane(topic.id, 'dry-codebase-fit'),
      topicVerdict(topic),
      globalVerdict(),
    ]);
    const artifacts = artifactStore();
    const output = await runMultiLensReview(input(), { tasks, artifacts });

    expect(output).toMatchObject({
      outcome: 'completed',
      plan: { topics: [{ id: 'change' }] },
      verdict: { recommendation: 'approve', coverageComplete: true },
    });
    const specialists = tasks.created.filter((task) =>
      task.title?.startsWith('Review change'),
    );
    expect(specialists).toHaveLength(2);
    for (const specialist of specialists) {
      expect(specialist.references).toHaveLength(1);
      expect(specialist.references?.[0].artifact?.cid).toBe('bafkrei-topic-1');
      expect(specialist.references?.[0].artifact?.cid).not.toBe(
        'bafkrei-manifest',
      );
      expect(specialist.references?.[0].artifact?.cid).not.toBe(
        'bafkrei-file-0',
      );
    }
    expect(artifacts.staged).toHaveLength(1);
  });

  it('lets the LLM exclude derived text without binding it to specialists', async () => {
    const topic = deterministicTopic();
    const exclusion = {
      path: 'derived.data',
      reason: 'machine-produced derived data',
      evidence: 'The file content declares its source and generator version.',
    };
    const tasks = new FakeTasks([
      preflight('PROCEED', [exclusion]),
      lane(topic.id, 'correctness'),
      lane(topic.id, 'dry-codebase-fit'),
      topicVerdict(topic),
      globalVerdict(),
    ]);
    const artifacts = artifactStore();
    const output = await runMultiLensReview(
      input({}, ['src/change.ts', 'derived.data']),
      { tasks, artifacts },
    );

    expect(output.diagnostics.coverage.excludedFiles).toEqual([
      { ...exclusion, source: 'model' },
    ]);
    expect(output.plan.topics[0].primaryFiles).toEqual(['src/change.ts']);
    expect(artifacts.staged[0]).toHaveLength(64);
  });

  it('declares one server-gated reducer per topic and a global gated synthesis', async () => {
    const topic = deterministicTopic();
    const tasks = new FakeTasks([
      preflight(),
      lane(topic.id, 'correctness'),
      lane(topic.id, 'dry-codebase-fit'),
      topicVerdict(topic),
      globalVerdict(),
    ]);
    await runMultiLensReview(input(), { tasks, artifacts: artifactStore() });
    expect(tasks.created[3].claimCondition).toEqual({
      op: 'all',
      conditions: [fakeId(2), fakeId(3)].map((taskId) => ({
        op: 'task_status',
        taskId,
        statuses: ['completed'],
      })),
    });
    expect(tasks.created[4].claimCondition).toEqual({
      op: 'task_status',
      taskId: fakeId(4),
      statuses: ['completed'],
    });
  });

  it('ends PIVOT and ASK before line-level specialist tasks', async () => {
    for (const verdict of ['PIVOT', 'ASK'] as const) {
      const tasks = new FakeTasks([preflight(verdict)]);
      const output = await runMultiLensReview(input(), {
        tasks,
        artifacts: artifactStore(),
      });
      expect(output.outcome).toBe(verdict === 'PIVOT' ? 'pivot' : 'questions');
      expect(tasks.created).toHaveLength(1);
      expect(
        tasks.created.some((task) => task.title?.startsWith('Review ')),
      ).toBe(false);
    }
  });

  it('runs the LLM planner only above trusted thresholds and rejects an invalid plan once', async () => {
    const invalidPlan = {
      version: 1 as const,
      excludedFiles: [],
      topics: [
        {
          id: 'bad',
          title: 'Bad',
          primaryFiles: [],
          lanes: [],
        },
      ],
    };
    const tasks = new FakeTasks([plannerSummary(invalidPlan), preflight()]);
    await expect(
      runMultiLensReview(input({ requiresPlanning: true }), {
        tasks,
        artifacts: artifactStore(64, invalidPlan),
      }),
    ).rejects.toThrow(/invalid topic plan/);
    expect(tasks.created.map((task) => task.title)).toEqual([
      'Plan bounded review topics',
      'Global design preflight',
    ]);
    expect(tasks.created[0].input.brief).toContain(
      'complete bounded review manifest is embedded below',
    );
    expect(tasks.created[0].input.brief).toContain(
      'or read the daemon checkout',
    );
    expect(tasks.created[0].input.brief).toContain('src/change.ts');
    expect(tasks.created[0].input.brief).toContain('bafkrei-file-0');
    expect(tasks.created[0].input.brief).toContain('Trusted lane-budget guide');
    expect(tasks.created[0].input.brief).toContain(
      'Use an empty `lanes` array',
    );
    expect(tasks.created[0].input.brief).toContain(
      'download its exact per-file artifact',
    );
    expect(tasks.created[0].input.brief).toContain(
      'union of excludedFiles and every topic',
    );
    expect(tasks.created[0].input.brief).toContain(
      'generally need four or fewer semantic topics',
    );
    expect(tasks.created[0].input.brief).toContain(
      'moltnet_upload_task_artifact',
    );
    expect(tasks.created[0].input.expectedOutput).toContain(
      'artifacts entry references the uploaded',
    );
    expect(tasks.created[1].input.brief).toContain(
      'only the explicit task-artifact CID is downloadable',
    );
  });

  it('rejects a planner output that does not reference its uploaded plan artifact', async () => {
    const plan = {
      version: 1 as const,
      excludedFiles: [],
      topics: [deterministicTopic()],
    };
    const tasks = new FakeTasks([summary(plan), preflight()]);

    await expect(
      runMultiLensReview(input({ requiresPlanning: true }), {
        tasks,
        artifacts: artifactStore(64, plan),
      }),
    ).rejects.toThrow(
      /must reference exactly one uploaded review-topic-plan\.v1\.json artifact/,
    );
  });

  it('rejects planner artifact bytes that differ from the submitted summary', async () => {
    const submittedPlan = {
      version: 1 as const,
      excludedFiles: [],
      topics: [deterministicTopic()],
    };
    const uploadedPlan = {
      ...submittedPlan,
      topics: [
        {
          ...deterministicTopic(),
          title: 'Different uploaded plan',
        },
      ],
    };
    const output = plannerSummary(submittedPlan);
    output.artifacts[0].sizeBytes = Buffer.byteLength(
      JSON.stringify(uploadedPlan),
    );
    const tasks = new FakeTasks([output, preflight()]);

    await expect(
      runMultiLensReview(input({ requiresPlanning: true }), {
        tasks,
        artifacts: artifactStore(64, uploadedPlan),
      }),
    ).rejects.toThrow(/planner artifact JSON does not match submitted summary/);
  });

  it('cannot approve failed required lanes or incomplete lane coverage', async () => {
    const topic = deterministicTopic();
    const failed = new FakeTasks([
      preflight(),
      { __taskStatus: 'failed', error: { message: 'review failed' } },
      lane(topic.id, 'dry-codebase-fit'),
      topicVerdict(topic),
      globalVerdict(),
    ]);
    await expect(
      runMultiLensReview(input(), {
        tasks: failed,
        artifacts: artifactStore(),
      }),
    ).rejects.toThrow();

    const incomplete = new FakeTasks([
      preflight(),
      lane(topic.id, 'correctness', []),
      lane(topic.id, 'dry-codebase-fit'),
      topicVerdict(topic),
      globalVerdict(),
    ]);
    await expect(
      runMultiLensReview(input(), {
        tasks: incomplete,
        artifacts: artifactStore(),
      }),
    ).rejects.toThrow(/did not cover/);
  });

  it('cannot approve incomplete topic or global coverage', async () => {
    const topic = deterministicTopic();
    const incompleteTopic = new FakeTasks([
      preflight(),
      lane(topic.id, 'correctness'),
      lane(topic.id, 'dry-codebase-fit'),
      summary({
        version: 1,
        topicId: topic.id,
        recommendation: 'approve',
        findings: [],
        coveredFiles: [],
        coveredLanes: topic.lanes,
        summary: 'Incomplete.',
      }),
      globalVerdict(),
    ]);
    await expect(
      runMultiLensReview(input(), {
        tasks: incompleteTopic,
        artifacts: artifactStore(),
      }),
    ).rejects.toThrow(/invalid coverage/);

    const incompleteGlobal = new FakeTasks([
      preflight(),
      lane(topic.id, 'correctness'),
      lane(topic.id, 'dry-codebase-fit'),
      topicVerdict(topic),
      globalVerdict(false),
    ]);
    await expect(
      runMultiLensReview(input(), {
        tasks: incompleteGlobal,
        artifacts: artifactStore(),
      }),
    ).rejects.toThrow(/cannot approve incomplete coverage/);
  });

  it('routes planner, preflight, lanes, reducers, and synthesis independently', async () => {
    const topic = deterministicTopic();
    const tasks = new FakeTasks([
      preflight(),
      lane(topic.id, 'correctness'),
      lane(topic.id, 'dry-codebase-fit'),
      topicVerdict(topic),
      globalVerdict(),
    ]);
    await runMultiLensReview(
      {
        ...input(),
        profileRouting: {
          defaultProfileId: 'default',
          preflightProfileId: 'preflight',
          laneProfileIds: { correctness: 'correctness' },
          topicReducerProfileId: 'reducer',
          globalSynthesisProfileId: 'synthesis',
        },
      },
      { tasks, artifacts: artifactStore() },
    );
    expect(
      tasks.created.map((task) => task.allowedProfiles?.[0]?.profileId),
    ).toEqual(['preflight', 'correctness', 'default', 'reducer', 'synthesis']);
  });
});

class StatefulGraphTasks implements TaskClient {
  readonly created: Array<Parameters<TaskClient['createTask']>[0]> = [];
  private readonly tasks = new Map<string, SdkTask>();
  private readonly attempts = new Map<string, SdkTaskAttempt[]>();
  private next = 1;

  createTask(body: Parameters<TaskClient['createTask']>[0]): Promise<SdkTask> {
    const id = fakeId(this.next++);
    const now = new Date().toISOString();
    const waiting = body.claimCondition !== undefined;
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
      acceptedAttemptN: null,
      claimCondition: body.claimCondition ?? null,
      requiredExecutorTrustLevel: 'selfDeclared',
      allowedProfiles: body.allowedProfiles ?? [],
      status: waiting ? 'waiting' : 'queued',
      queuedAt: waiting ? null : now,
      completedAt: null,
      expiresAt: null,
      cancelledByAgentId: null,
      cancelledByHumanId: null,
      cancelReason: null,
      maxAttempts: 1,
      dispatchTimeoutSec: null,
      runningTimeoutSec: null,
    } as SdkTask;
    this.created.push(body);
    this.tasks.set(id, task);
    this.attempts.set(id, []);
    return Promise.resolve(task);
  }

  getTask(id: string): Promise<SdkTask> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`missing task ${id}`);
    return Promise.resolve(task);
  }

  listAttempts(id: string): Promise<SdkTaskAttempt[]> {
    return Promise.resolve(this.attempts.get(id) ?? []);
  }

  complete(id: string, output: Record<string, unknown>): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`missing task ${id}`);
    const now = new Date().toISOString();
    Object.assign(task, {
      status: 'completed',
      acceptedAttemptN: 1,
      completedAt: now,
    });
    this.attempts.set(id, [
      {
        taskId: id,
        attemptN: 1,
        claimedByAgentId: 'agent',
        leaseId: null,
        runtimeProfileId: null,
        runtimeProfileRevision: null,
        policySnapshotHash: null,
        runtimeId: null,
        claimedAt: now,
        startedAt: now,
        completedAt: now,
        status: 'completed',
        output,
        outputCid: `cid-${id}`,
        claimedExecutorFingerprint: null,
        claimedExecutorManifest: null,
        completedExecutorFingerprint: null,
        completedExecutorManifest: null,
        error: null,
        usage: null,
        contentSignature: null,
        signedAt: null,
        daemonState: null,
      } as SdkTaskAttempt,
    ]);
    this.promote();
  }

  private promote(): void {
    for (const task of this.tasks.values()) {
      if (task.status !== 'waiting') continue;
      const conditions =
        task.claimCondition?.op === 'all'
          ? task.claimCondition.conditions
          : task.claimCondition
            ? [task.claimCondition]
            : [];
      if (
        conditions.every(
          (condition) =>
            condition.op === 'task_status' &&
            this.tasks.get(condition.taskId)?.status === 'completed',
        )
      ) {
        Object.assign(task, {
          status: 'queued',
          queuedAt: new Date().toISOString(),
        });
      }
    }
  }
}

function controlledContext(): {
  ctx: WorkflowContext;
  release: () => void;
} {
  let waiters: Array<() => void> = [];
  return {
    ctx: {
      step: (_name, fn) => fn(),
      sleepFor: () =>
        new Promise<void>((resolve) => {
          waiters.push(resolve);
        }),
    },
    release: () => {
      const current = waiters;
      waiters = [];
      current.forEach((resolve) => resolve());
    },
  };
}

describe('stateful graph gates', () => {
  it('promotes planner → preflight → lanes → reducer → global synthesis', async () => {
    const tasks = new StatefulGraphTasks();
    const { ctx, release } = controlledContext();
    const topic: ReviewTopic = {
      id: 'topic',
      title: 'Topic',
      primaryFiles: ['src/change.ts'],
      lanes: ['correctness', 'dry-codebase-fit'],
    };
    const plannerPlan = {
      version: 1 as const,
      excludedFiles: [],
      topics: [topic],
    };
    const run = runMultiLensReview(
      input({ requiresPlanning: true }),
      { tasks, artifacts: artifactStore(64, plannerPlan) },
      ctx,
    );

    await vi.waitFor(() => expect(tasks.created).toHaveLength(2));
    expect((await tasks.getTask(fakeId(2))).status).toBe('waiting');
    tasks.complete(fakeId(1), plannerSummary(plannerPlan));
    release();
    await vi.waitFor(async () => {
      expect((await tasks.getTask(fakeId(2))).status).toBe('queued');
    });
    tasks.complete(fakeId(2), preflight());
    release();

    await vi.waitFor(() => expect(tasks.created).toHaveLength(6));
    expect((await tasks.getTask(fakeId(5))).status).toBe('waiting');
    expect((await tasks.getTask(fakeId(6))).status).toBe('waiting');
    tasks.complete(fakeId(3), lane('topic', 'correctness'));
    release();
    expect((await tasks.getTask(fakeId(5))).status).toBe('waiting');
    tasks.complete(fakeId(4), lane('topic', 'dry-codebase-fit'));
    release();
    await vi.waitFor(async () => {
      expect((await tasks.getTask(fakeId(5))).status).toBe('queued');
    });
    tasks.complete(fakeId(5), topicVerdict(topic));
    release();
    await vi.waitFor(async () => {
      expect((await tasks.getTask(fakeId(6))).status).toBe('queued');
    });
    tasks.complete(fakeId(6), globalVerdict());
    release();

    await expect(run).resolves.toMatchObject({
      outcome: 'completed',
      verdict: { recommendation: 'approve' },
    });
  });
});
