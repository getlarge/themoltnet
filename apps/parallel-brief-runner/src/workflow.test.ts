import { FakeTasks } from '@moltnet/orchestration/testing';
import { describe, expect, it } from 'vitest';

import { runParallelBriefs } from './workflow.js';

/** Ids FakeTasks assigns, in creation order. */
function fakeId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

describe('runParallelBriefs', () => {
  it('fans out briefs and joins them with a server-gated summary', async () => {
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

    // Four tasks: three briefs + one summary.
    expect(tasks.created).toHaveLength(4);
    const briefIds = [fakeId(1), fakeId(2), fakeId(3)];

    // The summary task is gated on ALL brief task ids via a server-side join.
    const summaryBody = tasks.created[3];
    expect(summaryBody.claimCondition).toEqual({
      op: 'all',
      conditions: briefIds.map((taskId) => ({
        op: 'task_status',
        taskId,
        statuses: ['completed'],
      })),
    });
    expect(summaryBody.references).toEqual(
      briefIds.map((taskId) => ({ taskId, role: 'context' })),
    );
  });

  it('rejects an empty brief list', async () => {
    const tasks = new FakeTasks([]);
    await expect(
      runParallelBriefs({ teamId: 't', diaryId: 'd', briefs: [] }, { tasks }),
    ).rejects.toThrow(/at least one brief/);
  });

  it('surfaces a brief that omits the summary field', async () => {
    const tasks = new FakeTasks([{ notSummary: 1 }]);
    await expect(
      runParallelBriefs(
        { teamId: 't', diaryId: 'd', correlationId: 'c', briefs: ['a'] },
        { tasks },
      ),
    ).rejects.toThrow(/missing string `summary`/);
  });
});
