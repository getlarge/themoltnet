import type {
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
  WorkflowContext,
} from '@themoltnet/tasks-orchestrator';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it, vi } from 'vitest';

import { MAX_REVIEW_DIFF_BYTES } from './diff-artifact.js';
import { runMultiLensReview } from './workflow.js';

/** Ids FakeTasks assigns, in creation order. */
function fakeId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

class StatefulJoinTasks implements TaskClient {
  readonly created: Array<Parameters<TaskClient['createTask']>[0]> = [];
  private readonly tasks = new Map<string, SdkTask>();
  private readonly attempts = new Map<string, SdkTaskAttempt[]>();
  private next = 1;

  async createTask(
    body: Parameters<TaskClient['createTask']>[0],
  ): Promise<SdkTask> {
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
    return task;
  }

  async getTask(id: string): Promise<SdkTask> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`missing task ${id}`);
    return task;
  }

  async listAttempts(id: string): Promise<SdkTaskAttempt[]> {
    return this.attempts.get(id) ?? [];
  }

  complete(id: string, summary: string): void {
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
        output: { summary },
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
    this.promoteSatisfiedJoins();
  }

  private promoteSatisfiedJoins(): void {
    for (const task of this.tasks.values()) {
      if (task.status !== 'waiting') continue;
      const dependencies =
        task.claimCondition?.op === 'all'
          ? task.claimCondition.conditions
          : task.claimCondition
            ? [task.claimCondition]
            : [];
      const satisfied = dependencies.every(
        (condition) =>
          condition.op === 'task_status' &&
          this.tasks.get(condition.taskId)?.status === 'completed',
      );
      if (satisfied) {
        Object.assign(task, {
          status: 'queued',
          queuedAt: new Date().toISOString(),
        });
      }
    }
  }
}

function controlledPollingContext(): {
  ctx: WorkflowContext;
  releasePolls: () => void;
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
    releasePolls: () => {
      const current = waiters;
      waiters = [];
      for (const resolve of current) resolve();
    },
  };
}

describe('runMultiLensReview', () => {
  it('fans out one review per lens and joins them with a server-gated synthesis declared up front', async () => {
    const tasks = new FakeTasks([
      { summary: 'sec findings' },
      { summary: 'correctness findings' },
      { summary: 'verdict' },
    ]);

    const out = await runMultiLensReview(
      {
        teamId: 't',
        diaryId: 'd',
        correlationId: 'corr-1',
        target: 'libs/foo/src/bar.ts',
        lenses: ['security', 'correctness'],
      },
      { tasks },
    );

    expect(out.reviews.map((r) => [r.lens, r.findings])).toEqual([
      ['security', 'sec findings'],
      ['correctness', 'correctness findings'],
    ]);
    expect(out.verdict).toBe('verdict');

    // Three tasks: two reviews, then the synthesis (declared in onCreated,
    // after all review ids exist but before the reviews are awaited).
    expect(tasks.created).toHaveLength(3);
    const reviewIds = [fakeId(1), fakeId(2)];
    const synthesisBody = tasks.created[2];
    expect(synthesisBody.title).toBe('Consolidated review verdict');

    // The synthesis is gated on ALL review task ids via a server-side join.
    expect(synthesisBody.claimCondition).toEqual({
      op: 'all',
      conditions: reviewIds.map((taskId) => ({
        op: 'task_status',
        taskId,
        statuses: ['completed'],
      })),
    });
    // No task-output references: at creation time the reviews have no accepted
    // output/outputCid yet (the join alone expresses the dependency).
    expect(synthesisBody.references ?? []).toEqual([]);
  });

  it('holds synthesis waiting until every review completes, then promotes it to queued', async () => {
    const tasks = new StatefulJoinTasks();
    const { ctx, releasePolls } = controlledPollingContext();
    const run = runMultiLensReview(
      {
        teamId: 't',
        diaryId: 'd',
        correlationId: 'stateful-join',
        target: 'libs/foo/src/bar.ts',
        lenses: ['security', 'correctness'],
        pollIntervalSec: 1,
      },
      { tasks },
      ctx,
    );

    await vi.waitFor(() => expect(tasks.created).toHaveLength(3));
    const synthesisId = fakeId(3);
    expect((await tasks.getTask(synthesisId)).status).toBe('waiting');

    tasks.complete(fakeId(1), 'security findings');
    expect((await tasks.getTask(synthesisId)).status).toBe('waiting');
    releasePolls();

    tasks.complete(fakeId(2), 'correctness findings');
    expect((await tasks.getTask(synthesisId)).status).toBe('queued');
    releasePolls();

    await vi.waitFor(async () => {
      expect((await tasks.getTask(synthesisId)).status).toBe('queued');
    });
    tasks.complete(synthesisId, 'consolidated verdict');
    releasePolls();

    await expect(run).resolves.toMatchObject({
      verdict: 'consolidated verdict',
    });
  });

  it('defaults to the four standard lenses when none are supplied', async () => {
    const tasks = new FakeTasks([
      { summary: 'a' },
      { summary: 'b' },
      { summary: 'c' },
      { summary: 'd' },
      { summary: 'verdict' },
    ]);

    const out = await runMultiLensReview(
      { teamId: 't', diaryId: 'd', correlationId: 'c', target: 'x' },
      { tasks },
    );

    expect(out.reviews.map((r) => r.lens)).toEqual([
      'security',
      'correctness',
      'performance',
      'test-coverage',
    ]);
    // Four reviews + one synthesis.
    expect(tasks.created).toHaveLength(5);
  });

  it('embeds a supplied diff into each review prompt', async () => {
    const tasks = new FakeTasks([{ summary: 'r' }, { summary: 'v' }]);
    await runMultiLensReview(
      {
        teamId: 't',
        diaryId: 'd',
        correlationId: 'c',
        target: 'x',
        lenses: ['security'],
        diff: 'DIFF-MARKER',
      },
      { tasks },
    );
    const reviewInput = tasks.created[0].input as { brief: string };
    expect(reviewInput.brief).toContain('DIFF-MARKER');
  });

  it('binds one staged diff CID to every review without copying bytes into prompts', async () => {
    const tasks = new FakeTasks([
      { summary: 'r1' },
      { summary: 'r2' },
      { summary: 'v' },
    ]);
    await runMultiLensReview(
      {
        teamId: 't',
        diaryId: 'd',
        correlationId: 'artifact-review',
        target: 'x',
        lenses: ['security', 'correctness'],
        diffArtifact: {
          cid: 'bafkreidiff',
          title: 'pull-request.diff',
          contentType: 'text/x-diff',
        },
      },
      { tasks },
    );

    for (const review of tasks.created.slice(0, 2)) {
      expect(review.references).toEqual([
        {
          taskId: null,
          role: 'context',
          artifact: {
            cid: 'bafkreidiff',
            kind: 'input',
            title: 'pull-request.diff',
            contentType: 'text/x-diff',
          },
        },
      ]);
      expect((review.input as { brief: string }).brief).toContain(
        'moltnet_download_task_artifact',
      );
    }
    expect(tasks.created[2].references).toBeUndefined();
  });

  it('sets a one-hour expiry backstop on review and synthesis tasks', async () => {
    const tasks = new FakeTasks([{ summary: 'r' }, { summary: 'v' }]);
    await runMultiLensReview(
      {
        teamId: 't',
        diaryId: 'd',
        correlationId: 'expiring-review',
        target: 'x',
        lenses: ['security'],
      },
      { tasks },
    );

    expect(tasks.created.map((task) => task.expiresInSec)).toEqual([
      3_600, 3_600,
    ]);
  });

  it('rejects an oversized inline diff before creating tasks', async () => {
    const tasks = new FakeTasks([]);
    await expect(
      runMultiLensReview(
        {
          teamId: 't',
          diaryId: 'd',
          correlationId: 'oversized-review',
          target: 'x',
          diff: 'x'.repeat(MAX_REVIEW_DIFF_BYTES + 1),
        },
        { tasks },
      ),
    ).rejects.toThrow(/exceeds the .*byte limit/);
    expect(tasks.created).toHaveLength(0);
  });

  it('rejects simultaneous inline and staged diffs', async () => {
    const tasks = new FakeTasks([]);
    await expect(
      runMultiLensReview(
        {
          teamId: 't',
          diaryId: 'd',
          correlationId: 'ambiguous-review',
          target: 'x',
          diff: 'inline',
          diffArtifact: {
            cid: 'bafkreidiff',
            title: 'pull-request.diff',
            contentType: 'text/x-diff',
          },
        },
        { tasks },
      ),
    ).rejects.toThrow(/either diff or diffArtifact/);
    expect(tasks.created).toHaveLength(0);
  });

  it('pins review and synthesis tasks to the routed runtime profiles', async () => {
    const tasks = new FakeTasks([
      { summary: 'security' },
      { summary: 'correctness' },
      { summary: 'verdict' },
    ]);
    await runMultiLensReview(
      {
        teamId: 't',
        diaryId: 'd',
        correlationId: 'c',
        target: 'x',
        lenses: ['security', 'correctness'],
        profileRouting: {
          defaultProfileId: '11111111-1111-4111-8111-111111111111',
          lensProfileIds: {
            security: '22222222-2222-4222-8222-222222222222',
          },
          synthesisProfileId: '33333333-3333-4333-8333-333333333333',
        },
      },
      { tasks },
    );

    expect(tasks.created[0].allowedProfiles).toEqual([
      { profileId: '22222222-2222-4222-8222-222222222222' },
    ]);
    expect(tasks.created[1].allowedProfiles).toEqual([
      { profileId: '11111111-1111-4111-8111-111111111111' },
    ]);
    expect(tasks.created[2].allowedProfiles).toEqual([
      { profileId: '33333333-3333-4333-8333-333333333333' },
    ]);
  });

  it('keeps tasks unrestricted when no profile routing is supplied', async () => {
    const tasks = new FakeTasks([
      { summary: 'review' },
      { summary: 'verdict' },
    ]);
    await runMultiLensReview(
      {
        teamId: 't',
        diaryId: 'd',
        correlationId: 'c',
        target: 'x',
        lenses: ['security'],
      },
      { tasks },
    );

    expect(tasks.created.every((task) => !task.allowedProfiles)).toBe(true);
  });

  it('rejects routing for a lens that is not part of the run', async () => {
    const tasks = new FakeTasks([]);
    await expect(
      runMultiLensReview(
        {
          teamId: 't',
          diaryId: 'd',
          correlationId: 'c',
          target: 'x',
          lenses: ['security'],
          profileRouting: {
            defaultProfileId: '11111111-1111-4111-8111-111111111111',
            lensProfileIds: {
              performance: '22222222-2222-4222-8222-222222222222',
            },
          },
        },
        { tasks },
      ),
    ).rejects.toThrow(/unknown lens "performance"/);
    expect(tasks.created).toHaveLength(0);
  });

  it('rejects an empty target', async () => {
    const tasks = new FakeTasks([]);
    await expect(
      runMultiLensReview(
        { teamId: 't', diaryId: 'd', correlationId: 'c', target: '   ' },
        { tasks },
      ),
    ).rejects.toThrow(/non-empty target/);
    expect(tasks.created).toHaveLength(0);
  });

  it('rejects more than the practical lens cap before creating any tasks', async () => {
    const tasks = new FakeTasks([]);
    const lenses = Array.from({ length: 9 }, (_v, i) => `lens-${i}`);
    await expect(
      runMultiLensReview(
        { teamId: 't', diaryId: 'd', correlationId: 'c', target: 'x', lenses },
        { tasks },
      ),
    ).rejects.toThrow(/at most 8/);
    expect(tasks.created).toHaveLength(0);
  });

  it('deduplicates repeated lenses so a run cannot be amplified', async () => {
    const tasks = new FakeTasks([{ summary: 's' }, { summary: 'v' }]);
    const out = await runMultiLensReview(
      {
        teamId: 't',
        diaryId: 'd',
        correlationId: 'c',
        target: 'x',
        lenses: ['security', 'security', 'security'],
      },
      { tasks },
    );
    expect(out.reviews.map((r) => r.lens)).toEqual(['security']);
    // one review + one synthesis
    expect(tasks.created).toHaveLength(2);
  });

  it('propagates the failure when a review output is malformed', async () => {
    // Second review output lacks `summary` → parse throws → the fan-out rejects.
    // (Cleanup of the orphaned synthesis is handled at the terminal outcome in
    // main.ts, not in the workflow — a per-attempt cancel would fight replay.)
    const tasks = new FakeTasks([
      { summary: 'ok' },
      {},
      { summary: 'never reached' },
    ]);
    await expect(
      runMultiLensReview(
        {
          teamId: 't',
          diaryId: 'd',
          correlationId: 'corr-fail',
          target: 'x',
          lenses: ['security', 'correctness'],
        },
        { tasks },
      ),
    ).rejects.toThrow(/missing string `summary`/);
  });

  it('requires a correlationId', async () => {
    const tasks = new FakeTasks([]);
    await expect(
      runMultiLensReview(
        {
          teamId: 't',
          diaryId: 'd',
          correlationId: '',
          target: 'x',
          lenses: ['security'],
        },
        { tasks },
      ),
    ).rejects.toThrow(/correlationId/);
    expect(tasks.created).toHaveLength(0);
  });
});
