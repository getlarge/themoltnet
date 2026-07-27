import { MAX_JOIN_TASKS } from '@themoltnet/tasks-orchestrator';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it } from 'vitest';

import { runParallelBriefs } from './workflow.js';

/** Ids FakeTasks assigns, in creation order. */
function fakeId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

describe('runParallelBriefs', () => {
  it('fans out briefs and joins them with a server-gated summary declared up front', async () => {
    const tasks = new FakeTasks([
      { summary: 'alpha' },
      { summary: 'beta' },
      { summary: 'gamma' },
      { summary: 'combined' },
    ]);

    const out = await runParallelBriefs(
      {
        teamId: 't',
        diaryId: 'd',
        correlationId: 'corr-1',
        briefs: ['a', 'b', 'c'],
        summaryBrief: 'combine',
      },
      { tasks },
    );

    expect(out.results.map((r) => r.summary)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(out.summary).toBe('combined');

    // Four tasks created: three briefs, then the summary (declared in onCreated,
    // i.e. after all brief ids exist but before the briefs are awaited).
    expect(tasks.created).toHaveLength(4);
    const briefIds = [fakeId(1), fakeId(2), fakeId(3)];
    const summaryBody = tasks.created[3];
    expect(summaryBody.title).toBe('Summarize parallel briefs');

    // The summary is gated on ALL brief task ids via a server-side join.
    expect(summaryBody.claimCondition).toEqual({
      op: 'all',
      conditions: briefIds.map((taskId) => ({
        op: 'task_status',
        taskId,
        statuses: ['completed'],
      })),
    });
    // No task-output references: at creation time the briefs have no accepted
    // output/outputCid yet (the join alone expresses the dependency).
    expect(summaryBody.references ?? []).toEqual([]);
  });

  it('rejects an empty brief list', async () => {
    const tasks = new FakeTasks([]);
    await expect(
      runParallelBriefs(
        { teamId: 't', diaryId: 'd', correlationId: 'c', briefs: [] },
        { tasks },
      ),
    ).rejects.toThrow(/at least one brief/);
  });

  it('rejects a fan-in larger than the join ceiling before creating any tasks', async () => {
    const tasks = new FakeTasks([]);
    const briefs = Array.from(
      { length: MAX_JOIN_TASKS + 1 },
      (_, i) => `brief ${i}`,
    );
    await expect(
      runParallelBriefs(
        { teamId: 't', diaryId: 'd', correlationId: 'c', briefs },
        { tasks },
      ),
    ).rejects.toThrow(/at most/);
    expect(tasks.created).toHaveLength(0);
  });

  it('requires a correlationId', async () => {
    const tasks = new FakeTasks([]);
    await expect(
      runParallelBriefs(
        { teamId: 't', diaryId: 'd', correlationId: '', briefs: ['a'] },
        { tasks },
      ),
    ).rejects.toThrow(/correlationId/);
  });

  it('surfaces a brief that omits the summary field', async () => {
    // Two outputs: the brief (invalid) + the up-front summary create. The brief
    // await rejects on the missing summary before the summary is awaited.
    const tasks = new FakeTasks([{ notSummary: 1 }, { summary: 'ignored' }]);
    await expect(
      runParallelBriefs(
        { teamId: 't', diaryId: 'd', correlationId: 'c', briefs: ['a'] },
        { tasks },
      ),
    ).rejects.toThrow(/missing string `summary`/);
  });
});
