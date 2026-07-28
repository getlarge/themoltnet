import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it } from 'vitest';

import { runMultiLensReview } from './workflow.js';

/** Ids FakeTasks assigns, in creation order. */
function fakeId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
