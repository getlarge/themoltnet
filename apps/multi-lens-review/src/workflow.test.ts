import type {
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
  WorkflowContext,
} from '@themoltnet/tasks-orchestrator';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it, vi } from 'vitest';

import { durableMultiLensReviewOutput } from './absurd.js';
import { hydrateMultiLensReviewOutput } from './review-output.js';
import { reviewManifest } from './test-fixtures.js';
import type {
  MultiLensReviewDeps,
  ReviewArtifactStore,
  ReviewLane,
  ReviewPatchSource,
  ReviewTopic,
} from './types.js';
import { assertReusablePlannerTask, runMultiLensReview } from './workflow.js';

function fakeId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function summary(value: unknown) {
  return { summary: JSON.stringify(value) };
}

function plannerSummary(value: unknown) {
  const body = JSON.stringify(value);
  return {
    summary: 'Uploaded review-topic-plan.v1.json for trusted validation.',
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

function preflight(verdict: 'PROCEED' | 'PIVOT' | 'ASK' = 'PROCEED') {
  return summary({
    verdict,
    summary: `${verdict} summary`,
    ...(verdict === 'ASK' ? { questions: ['What is the contract?'] } : {}),
  });
}

function laneResult(topicId: string, lane: ReviewLane, files: string[]) {
  return {
    version: 1,
    topicId,
    lane,
    findings: [],
    reviewedFiles: files,
    summary: 'Clean.',
  };
}

function topicReview(
  topic: ReviewTopic,
  lanes: ReviewLane[] = topic.lanes,
  files: string[] = topic.primaryFiles,
) {
  return summary({
    version: 1,
    topicId: topic.id,
    laneResults: lanes.map((lane) => laneResult(topic.id, lane, files)),
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
  staged: Array<{ bytes: Uint8Array; contentType: string }>;
  patches: ReviewPatchSource;
} {
  const staged: Array<{ bytes: Uint8Array; contentType: string }> = [];
  return {
    staged,
    patches: {
      read: vi.fn(() => Promise.resolve(new Uint8Array(fileBytes))),
    },
    download: vi.fn((_taskId, cid) =>
      Promise.resolve(
        cid === 'bafkrei-planner-output'
          ? new TextEncoder().encode(JSON.stringify(plannerOutput))
          : new Uint8Array(fileBytes),
      ),
    ),
    stage: vi.fn(
      (
        bytes: Uint8Array,
        metadata: { contentType: string },
      ): Promise<{
        cid: string;
        contentType: string;
        sizeBytes: number;
      }> => {
        staged.push({ bytes, contentType: metadata.contentType });
        return Promise.resolve({
          cid: `bafkrei-staged-${staged.length}`,
          contentType: metadata.contentType,
          sizeBytes: bytes.byteLength,
        });
      },
    ),
  };
}

function deps(
  tasks: TaskClient,
  artifacts = artifactStore(),
): MultiLensReviewDeps {
  return { tasks, artifacts, patches: artifacts.patches };
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
    reviewBaseRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    reviewRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    reviewManifest: reviewManifest(paths, options),
    pollIntervalSec: 1,
  };
}

function reusablePlannerTask(references: SdkTask['references']): SdkTask {
  return {
    id: 'accepted-planner-task',
    taskType: 'freeform',
    title: 'Plan bounded review topics',
    teamId: 'team',
    diaryId: 'diary',
    status: 'completed',
    acceptedAttemptN: 1,
    references,
  } as SdkTask;
}

describe('runMultiLensReview', () => {
  it('allows one explicit recovery candidate on an accepted reusable planner task', () => {
    const normalized = {
      ...input({ requiresPlanning: true }),
      requestedLanes: [],
    } as Parameters<typeof assertReusablePlannerTask>[1];
    const manifest = normalized.reviewManifest.manifestArtifact;
    const task = reusablePlannerTask([
      {
        taskId: null,
        role: 'context',
        artifact: {
          cid: manifest.cid,
          kind: 'input',
          title: manifest.title,
          contentType: manifest.contentType,
        },
      },
      {
        taskId: null,
        role: 'context',
        artifact: {
          cid: 'bafkrei-recovered-candidate',
          kind: 'review-topic-plan-candidate',
          title: 'review-topic-plan.candidate.json',
          contentType:
            'application/vnd.themoltnet.review-topic-plan-candidate+json',
        },
      },
    ]);

    expect(() => assertReusablePlannerTask(task, normalized)).not.toThrow();
  });

  it('rejects arbitrary extra artifacts on an accepted reusable planner task', () => {
    const normalized = {
      ...input({ requiresPlanning: true }),
      requestedLanes: [],
    } as Parameters<typeof assertReusablePlannerTask>[1];
    const manifest = normalized.reviewManifest.manifestArtifact;
    const task = reusablePlannerTask([
      {
        taskId: null,
        role: 'context',
        artifact: {
          cid: manifest.cid,
          kind: 'input',
          title: manifest.title,
          contentType: manifest.contentType,
        },
      },
      {
        taskId: null,
        role: 'context',
        artifact: {
          cid: 'bafkrei-untrusted-extra',
          kind: 'input',
          title: 'unrelated.txt',
          contentType: 'text/plain',
        },
      },
    ]);

    expect(() => assertReusablePlannerTask(task, normalized)).toThrow(
      /artifact references other than/,
    );
  });

  it('reuses accepted preflight and topic tasks while creating only missing downstream work', async () => {
    const topic = deterministicTopic();
    const tasks = new FakeTasks([
      preflight(),
      topicReview(topic),
      globalVerdict(),
      globalVerdict(),
    ]);
    const firstArtifacts = artifactStore();
    const first = await runMultiLensReview(
      input(),
      deps(tasks, firstArtifacts),
    );

    const secondArtifacts = artifactStore();
    const second = await runMultiLensReview(
      {
        ...input(),
        correlationId: 'recovery-correlation',
        preflightTaskId: first.phaseOutputs.preflight?.taskId,
        topicReviewTaskIds: first.phaseOutputs.topicReviews.map(
          (review) => review.taskId,
        ),
      },
      deps(tasks, secondArtifacts),
    );

    expect(second.outcome).toBe('completed');
    expect(second.phaseOutputs.preflight?.taskId).toBe(
      first.phaseOutputs.preflight?.taskId,
    );
    expect(second.phaseOutputs.topicReviews).toEqual(
      first.phaseOutputs.topicReviews,
    );
    expect(tasks.created).toHaveLength(4);
    expect(tasks.created[3].title).toBe('Global review synthesis');
  });

  it('reuses a strict-output continuation through its accepted topic parent lineage', async () => {
    const topic = deterministicTopic();
    const tasks = new FakeTasks([
      preflight(),
      topicReview(topic),
      globalVerdict(),
      topicReview(topic),
      globalVerdict(),
    ]);
    const first = await runMultiLensReview(input(), deps(tasks));
    const parentTaskId = first.phaseOutputs.topicReviews[0].taskId;
    const continuation = await tasks.createTask({
      teamId: 'team',
      diaryId: 'diary',
      taskType: 'freeform',
      input: {
        brief: 'Correct only the previously submitted JSON serialization.',
        continueFrom: {
          taskId: parentTaskId,
          attemptN: 1,
        },
      },
      claimCondition: {
        op: 'task_status',
        taskId: parentTaskId,
        statuses: ['completed'],
      },
      maxAttempts: 1,
    });

    const recovered = await runMultiLensReview(
      {
        ...input(),
        correlationId: 'continuation-recovery',
        preflightTaskId: first.phaseOutputs.preflight?.taskId,
        topicReviewTaskIds: [continuation.id],
      },
      deps(tasks),
    );

    expect(recovered.outcome).toBe('completed');
    expect(recovered.phaseOutputs.topicReviews[0].taskId).toBe(continuation.id);
    expect(tasks.created).toHaveLength(5);
    expect(tasks.created[4].title).toBe('Global review synthesis');
  });

  it('checkpoints only task ids and artifact references', async () => {
    const topic = deterministicTopic();
    const tasks = new FakeTasks([
      preflight(),
      topicReview(topic),
      globalVerdict(),
    ]);
    const checkpointed = new Map<string, unknown>();
    const ctx: WorkflowContext = {
      step: async (name, fn) => {
        const value = await fn();
        checkpointed.set(name, value);
        return value;
      },
      sleepFor: () => Promise.resolve(),
    };

    await runMultiLensReview(input(), deps(tasks), ctx);

    for (const [name, value] of checkpointed) {
      if (name.endsWith('.create')) {
        expect(value, name).toEqual(expect.any(String));
      }
      if (name.endsWith('.artifact.stage')) {
        expect(value, name).toHaveProperty('cid');
        expect(typeof (value as { cid: unknown }).cid, name).toBe('string');
      }
    }
  });

  it('bounds global synthesis to one artifact read and at most 20 findings', async () => {
    const topic = deterministicTopic();
    const tasks = new FakeTasks([
      preflight(),
      topicReview(topic),
      globalVerdict(),
    ]);

    await runMultiLensReview(input(), deps(tasks));

    const synthesis = tasks.created.find(
      (task) => task.title === 'Global review synthesis',
    );
    expect(synthesis).toBeDefined();
    expect((synthesis?.input as { brief: string }).brief).toContain(
      'Return at most 20 findings',
    );
    expect(
      (synthesis?.input as { constraints: string[] }).constraints,
    ).toContain(
      'Do not use bash, write, edit, repository, memory, or task-list tools.',
    );
    expect(
      (
        synthesis?.input as {
          successCriteria: { gates: Array<{ id: string }> };
        }
      ).successCriteria.gates,
    ).toContainEqual(expect.objectContaining({ id: 'submit-global-verdict' }));
  });

  it('persists only remote output references in the Absurd result', async () => {
    const topic = deterministicTopic();
    const tasks = new FakeTasks([
      preflight(),
      topicReview(topic),
      globalVerdict(),
    ]);
    const output = await runMultiLensReview(input(), deps(tasks));

    const durable = durableMultiLensReviewOutput(output);

    expect(durable).not.toHaveProperty('plan');
    expect(durable).not.toHaveProperty('preflight');
    expect(durable).not.toHaveProperty('topicVerdicts');
    expect(durable).not.toHaveProperty('verdict');
    expect(durable.phaseOutputs.topicVerdictsArtifact).toMatchObject({
      cid: 'bafkrei-staged-2',
    });
    expect(durable.phaseOutputs.globalSynthesis).toMatchObject({
      taskId: fakeId(3),
      attemptN: 1,
      outputCid: `cid-${fakeId(3)}`,
    });
    await expect(
      hydrateMultiLensReviewOutput(durable, tasks),
    ).resolves.toMatchObject({
      verdict: { recommendation: 'approve', coverageComplete: true },
    });
  });

  it('uses one bounded multi-lens task per topic at the exact review revision', async () => {
    const topic = deterministicTopic();
    const tasks = new FakeTasks([
      preflight(),
      topicReview(topic),
      globalVerdict(),
    ]);
    const artifacts = artifactStore();
    const revision = 'a'.repeat(40);
    const output = await runMultiLensReview(
      { ...input(), reviewRevision: revision },
      deps(tasks, artifacts),
    );

    expect(output).toMatchObject({
      outcome: 'completed',
      plan: { topics: [{ id: 'change' }] },
      verdict: { recommendation: 'approve', coverageComplete: true },
    });
    const reviewers = tasks.created.filter((task) =>
      task.title?.startsWith('Review topic change'),
    );
    expect(reviewers).toHaveLength(1);
    expect(reviewers[0].input.execution).toEqual({
      workspace: 'dedicated_worktree',
      revision,
    });
    expect(reviewers[0].references).toHaveLength(1);
    expect(reviewers[0].references?.[0].artifact?.cid).toBe('bafkrei-staged-1');
    expect(reviewers[0].input.brief).toContain('bafkrei-staged-1');
    expect(reviewers[0].input.brief).toContain(
      'moltnet_download_task_artifact',
    );
    expect(reviewers[0].input.brief).toContain('not a guest file');
    expect(reviewers[0].input.brief).toContain(
      'at most one parallel repository-search batch',
    );
    expect(reviewers[0].input.brief).toContain('Do not use bash');
    expect(reviewers[0].input.brief).toContain(
      "reviewedFiles must equal exactly this topic's primaryFiles",
    );
    expect(reviewers[0].input.brief).toContain(
      'repository-search matches may inform a lane but must never appear in reviewedFiles',
    );
    expect(reviewers[0].input.constraints).toContain(
      'Finish within seven tool-use turns and submit as soon as the bounded evidence is sufficient.',
    );
    expect(reviewers[0].input.successCriteria).toMatchObject({
      version: 1,
      gates: [{ id: 'submit-topic-review' }],
    });
    expect(tasks.created[0].input.execution).toEqual({
      workspace: 'dedicated_worktree',
      revision,
    });
    expect(tasks.created[0].references).toHaveLength(1);
    expect(tasks.created[0].references?.[0].artifact?.cid).toBe(
      'bafkrei-manifest',
    );
    expect(tasks.created[0].input.brief).toContain(
      'no per-file patch payload was uploaded before classification',
    );
    expect(tasks.created[0].input.brief).toContain('Tool-turn budget');
    expect(tasks.created[0].input.successCriteria).toMatchObject({
      version: 1,
      gates: [{ id: 'submit-design-preflight' }],
    });
    expect(tasks.created[2].input.execution).toEqual({ workspace: 'none' });
    expect(artifacts.staged).toHaveLength(2);
  });

  it('counts the accepted planner output in artifact diagnostics', async () => {
    const topic = deterministicTopic();
    const plan = {
      version: 1 as const,
      generatedCandidates: [],
      topics: [topic],
    };
    const tasks = new FakeTasks([
      plannerSummary(plan),
      preflight(),
      topicReview(topic),
      globalVerdict(),
    ]);
    const artifacts = artifactStore(64, plan);

    const output = await runMultiLensReview(
      input({ requiresPlanning: true }),
      deps(tasks, artifacts),
    );

    expect(output.diagnostics.cost.artifacts).toBe(4);
    expect(output.diagnostics.cost.artifactBytes).toBe(
      100 +
        Buffer.byteLength(JSON.stringify(plan)) +
        artifacts.staged.reduce(
          (total, artifact) => total + artifact.bytes.byteLength,
          0,
        ),
    );
  });

  it('keeps model-generated candidates bound to mandatory topic review', async () => {
    const topic: ReviewTopic = {
      ...deterministicTopic(),
      primaryFiles: ['src/change.ts', 'derived.data'],
    };
    const candidate = {
      path: 'derived.data',
      reason: 'machine-produced derived data',
      evidence: 'The file content declares its source and generator version.',
    };
    const plan = {
      version: 1 as const,
      generatedCandidates: [candidate],
      topics: [topic],
    };
    const tasks = new FakeTasks([
      plannerSummary(plan),
      preflight(),
      topicReview(topic),
      globalVerdict(),
    ]);
    const output = await runMultiLensReview(
      input({ requiresPlanning: true }, ['src/change.ts', 'derived.data']),
      deps(tasks, artifactStore(64, plan)),
    );

    expect(output.diagnostics.coverage.excludedFiles).toEqual([]);
    expect(output.plan.topics[0].primaryFiles).toEqual([
      'src/change.ts',
      'derived.data',
    ]);
    const review = tasks.created.find((task) =>
      task.title?.startsWith('Review topic'),
    );
    expect(review?.input.brief).toContain(
      'non-authoritative generated candidates',
    );
    expect(review?.input.brief).toContain('derived.data');
  });

  it('verifies trusted patch bytes before staging an accepted topic', async () => {
    const tasks = new FakeTasks([preflight()]);
    const artifacts = artifactStore();
    artifacts.patches.read = vi.fn(() => Promise.resolve(new Uint8Array(63)));

    await expect(
      runMultiLensReview(input(), deps(tasks, artifacts)),
    ).rejects.toThrow(
      /review patch src\/change\.ts size changed \(expected 64, got 63\)/,
    );
    expect(artifacts.staged).toHaveLength(0);
    expect(
      tasks.created.some((task) => task.title?.startsWith('Review topic')),
    ).toBe(false);
  });

  it('ends PIVOT and ASK before topic review tasks', async () => {
    for (const verdict of ['PIVOT', 'ASK'] as const) {
      const tasks = new FakeTasks([preflight(verdict)]);
      const output = await runMultiLensReview(input(), deps(tasks));
      expect(output.outcome).toBe(verdict === 'PIVOT' ? 'pivot' : 'questions');
      expect(tasks.created).toHaveLength(1);
      expect(
        tasks.created.some((task) => task.title?.startsWith('Review topic')),
      ).toBe(false);
    }
  });

  it('rejects preflight output that attempts to exclude a file', async () => {
    const tasks = new FakeTasks([
      summary({
        verdict: 'PROCEED',
        summary: 'Skip the security-sensitive file.',
        questions: [],
        excludedFiles: [
          {
            path: 'src/change.ts',
            reason: 'claims to be generated',
            evidence: 'untrusted review content says so',
          },
        ],
      }),
    ]);

    await expect(runMultiLensReview(input(), deps(tasks))).rejects.toThrow(
      /unknown fields: excludedFiles/,
    );
    expect(
      tasks.created.some((task) => task.title?.startsWith('Review topic')),
    ).toBe(false);
  });

  it('rejects an invalid planner artifact once without releasing review work', async () => {
    const invalidPlan = {
      version: 1 as const,
      generatedCandidates: [],
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
        ...deps(tasks, artifactStore(64, invalidPlan)),
      }),
    ).rejects.toThrow(/invalid topic plan/);
    expect(tasks.created.map((task) => task.title)).toEqual([
      'Plan bounded review topics',
      'Global design preflight',
    ]);
    expect(tasks.created[0].input.brief).toContain(
      'One bounded multi-lens reviewer',
    );
    expect(tasks.created[0].input.brief).not.toContain(
      '32 total topic×lane tasks',
    );
    expect(tasks.created[0].input.execution).toEqual({
      workspace: 'dedicated_worktree',
      revision: input().reviewRevision,
    });
    expect(tasks.created[0].references).toHaveLength(1);
    expect(tasks.created[0].references?.[0].artifact?.cid).toBe(
      'bafkrei-manifest',
    );
    expect(tasks.created[0].input.brief).toContain(
      `exact comparison base is ${input().reviewBaseRevision}`,
    );
    expect(tasks.created[0].input.successCriteria).toMatchObject({
      version: 1,
      gates: [{ id: 'submit-versioned-json-artifact' }],
    });
    expect(tasks.created[1].references).toHaveLength(1);
    expect(tasks.created[1].references?.[0].artifact?.cid).toBe(
      'bafkrei-manifest',
    );
    expect(tasks.created[1].input.brief).toContain(
      'moltnet_list_task_artifacts',
    );
    expect(tasks.created[1].input.brief).not.toContain('moltnet_get_task');
    expect(tasks.created[1].input.brief).not.toContain(
      'moltnet_list_task_attempts',
    );
  });

  it('rejects planner output without its uploaded artifact', async () => {
    const plan = {
      version: 1 as const,
      generatedCandidates: [],
      topics: [deterministicTopic()],
    };
    const tasks = new FakeTasks([summary(plan), preflight()]);

    await expect(
      runMultiLensReview(input({ requiresPlanning: true }), {
        ...deps(tasks, artifactStore(64, plan)),
      }),
    ).rejects.toThrow(
      /must reference exactly one uploaded review-topic-plan\.v1\.json artifact/,
    );
  });

  it('uses a canary and does not release remaining topics after its failure', async () => {
    const topics: ReviewTopic[] = [
      {
        id: 'one',
        title: 'One',
        primaryFiles: ['one.ts'],
        lanes: ['correctness', 'dry-codebase-fit'],
      },
      {
        id: 'two',
        title: 'Two',
        primaryFiles: ['two.ts'],
        lanes: ['correctness', 'dry-codebase-fit'],
      },
    ];
    const plan = {
      version: 1 as const,
      generatedCandidates: [],
      topics,
    };
    const tasks = new FakeTasks([
      plannerSummary(plan),
      preflight(),
      { __taskStatus: 'failed', error: { message: 'canary failed' } },
    ]);

    await expect(
      runMultiLensReview(
        input({ requiresPlanning: true }, ['one.ts', 'two.ts']),
        deps(tasks, artifactStore(64, plan)),
      ),
    ).rejects.toThrow();
    expect(
      tasks.created.filter((task) => task.title?.startsWith('Review topic')),
    ).toHaveLength(1);
    expect(
      tasks.created.some((task) => task.title === 'Global review synthesis'),
    ).toBe(false);
  });

  it('cannot approve incomplete lane or global coverage', async () => {
    const topic = deterministicTopic();
    const incomplete = new FakeTasks([
      preflight(),
      topicReview(topic, topic.lanes, []),
    ]);
    await expect(runMultiLensReview(input(), deps(incomplete))).rejects.toThrow(
      /did not cover/,
    );

    const incompleteGlobal = new FakeTasks([
      preflight(),
      topicReview(topic),
      globalVerdict(false),
    ]);
    await expect(
      runMultiLensReview(input(), deps(incompleteGlobal)),
    ).rejects.toThrow(/cannot approve incomplete coverage/);
  });

  it('groups topic lanes by runtime profile without breaking lane overrides', async () => {
    const topic = deterministicTopic();
    const tasks = new FakeTasks([
      preflight(),
      topicReview(topic, ['correctness']),
      topicReview(topic, ['dry-codebase-fit']),
      globalVerdict(),
    ]);
    await runMultiLensReview(
      {
        ...input(),
        profileRouting: {
          defaultProfileId: 'default',
          preflightProfileId: 'preflight',
          laneProfileIds: { correctness: 'correctness' },
          topicReducerProfileId: 'topic-review',
          globalSynthesisProfileId: 'synthesis',
        },
      },
      deps(tasks),
    );

    expect(
      tasks.created.map((task) => task.allowedProfiles?.[0]?.profileId),
    ).toEqual(['preflight', 'correctness', 'topic-review', 'synthesis']);
    expect(
      tasks.created.filter((task) => task.title?.startsWith('Review topic')),
    ).toHaveLength(2);
  });

  it('rejects profile routing that expands beyond the bounded topic task budget', async () => {
    const paths = Array.from({ length: 7 }, (_, index) => `src/${index}.ts`);
    const plan = {
      version: 1 as const,
      generatedCandidates: [],
      topics: paths.map((path, index) => ({
        id: `topic-${index}`,
        title: `Topic ${index}`,
        primaryFiles: [path],
        lanes: [] as ReviewLane[],
      })),
    };
    const tasks = new FakeTasks([plannerSummary(plan), preflight()]);
    const artifacts = artifactStore(64, plan);

    await expect(
      runMultiLensReview(
        {
          ...input({ requiresPlanning: true }, paths),
          profileRouting: {
            defaultProfileId: 'default',
            laneProfileIds: { correctness: 'correctness' },
          },
        },
        deps(tasks, artifacts),
      ),
    ).rejects.toThrow(
      /expands 7 topics into 14 topic review tasks; maximum is 12/,
    );
    expect(artifacts.staged).toHaveLength(0);
    expect(tasks.created.map((task) => task.title)).toEqual([
      'Plan bounded review topics',
      'Global design preflight',
    ]);
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
      status: body.claimCondition ? 'waiting' : 'queued',
      queuedAt: body.claimCondition ? null : now,
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
    this.promote();
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
  it('promotes planner → preflight → canary → remaining topics → synthesis', async () => {
    const tasks = new StatefulGraphTasks();
    const { ctx, release } = controlledContext();
    const topics: ReviewTopic[] = [
      {
        id: 'one',
        title: 'One',
        primaryFiles: ['one.ts'],
        lanes: ['correctness', 'dry-codebase-fit'],
      },
      {
        id: 'two',
        title: 'Two',
        primaryFiles: ['two.ts'],
        lanes: ['correctness', 'dry-codebase-fit'],
      },
    ];
    const plannerPlan = {
      version: 1 as const,
      generatedCandidates: [],
      topics,
    };
    const run = runMultiLensReview(
      input({ requiresPlanning: true }, ['one.ts', 'two.ts']),
      deps(tasks, artifactStore(64, plannerPlan)),
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

    await vi.waitFor(() => expect(tasks.created).toHaveLength(3));
    expect(tasks.created[2].title).toContain('Review topic one');
    tasks.complete(fakeId(3), topicReview(topics[0]));
    release();

    await vi.waitFor(() => expect(tasks.created).toHaveLength(4));
    expect(tasks.created[3].title).toContain('Review topic two');
    expect(
      tasks.created.some((task) => task.title === 'Global review synthesis'),
    ).toBe(false);
    tasks.complete(fakeId(4), topicReview(topics[1]));
    release();

    await vi.waitFor(() => expect(tasks.created).toHaveLength(5));
    expect((await tasks.getTask(fakeId(5))).status).toBe('queued');
    tasks.complete(fakeId(5), globalVerdict());
    release();

    await expect(run).resolves.toMatchObject({
      outcome: 'completed',
      verdict: { recommendation: 'approve' },
    });
  });
});
