import { describe, expect, it } from 'vitest';

import { groupTasksByLane, statusToLane, TASK_LANES } from '../task-lanes.js';
import type { TaskStatus, TaskSummary } from '../types.js';
import { taskFixture } from './fixtures.js';

function taskWith(status: TaskStatus, id: string): TaskSummary {
  return { ...taskFixture, id, status };
}

describe('task-lanes', () => {
  it('maps every status to exactly one lane', () => {
    const statuses: TaskStatus[] = [
      'waiting',
      'queued',
      'dispatched',
      'running',
      'completed',
      'failed',
      'cancelled',
      'expired',
    ];
    const lanes = statuses.map(statusToLane);
    expect(lanes).toEqual([
      'pending',
      'pending',
      'active',
      'active',
      'done',
      'failed',
      'closed',
      'closed',
    ]);
  });

  it('orders lanes pending -> active -> done -> failed -> closed', () => {
    expect(TASK_LANES.map((lane) => lane.id)).toEqual([
      'pending',
      'active',
      'done',
      'failed',
      'closed',
    ]);
  });

  it('groups tasks into lane buckets preserving order', () => {
    const tasks = [
      taskWith('queued', 'a'),
      taskWith('running', 'b'),
      taskWith('completed', 'c'),
      taskWith('queued', 'd'),
    ];
    const grouped = groupTasksByLane(tasks);
    expect(grouped.pending.map((t) => t.id)).toEqual(['a', 'd']);
    expect(grouped.active.map((t) => t.id)).toEqual(['b']);
    expect(grouped.done.map((t) => t.id)).toEqual(['c']);
    expect(grouped.failed).toEqual([]);
    expect(grouped.closed).toEqual([]);
  });

  it('returns empty buckets for empty input', () => {
    const grouped = groupTasksByLane([]);
    expect(Object.values(grouped).every((b) => b.length === 0)).toBe(true);
  });
});
