import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';

import { TaskLaneCard } from '../task-lane-card.js';
import { TaskLaneColumn } from '../task-lane-column.js';
import { groupTasksByLane, statusToLane, TASK_LANES } from '../task-lanes.js';
import type { TaskStatus, TaskSummary } from '../types.js';
import { taskFixture } from './fixtures.js';

function taskWith(status: TaskStatus, id: string): TaskSummary {
  return { ...taskFixture, id, status };
}

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider mode="light">{ui}</MoltThemeProvider>);
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

describe('TaskLaneCard', () => {
  it('renders type, short id, and status badge', () => {
    renderWithTheme(<TaskLaneCard task={taskWith('running', 'abcdef1234')} />);
    expect(screen.getByText('Curate Pack')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('abcdef12')).toBeInTheDocument();
  });

  it('invokes onSelect with the task when clicked', () => {
    let selected: string | undefined;
    const task = taskWith('running', 'abcdef1234');
    renderWithTheme(
      <TaskLaneCard task={task} onSelect={(t) => (selected = t.id)} />,
    );
    screen.getByRole('button').click();
    expect(selected).toBe('abcdef1234');
  });
});

describe('TaskLaneColumn', () => {
  it('renders lane title, count, and an empty hint when no tasks', () => {
    const lane = TASK_LANES[0];
    renderWithTheme(<TaskLaneColumn lane={lane} tasks={[]} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders one card per task', () => {
    const lane = TASK_LANES[1]; // active
    renderWithTheme(
      <TaskLaneColumn
        lane={lane}
        tasks={[
          taskWith('running', 'aaaa1111'),
          taskWith('running', 'bbbb2222'),
        ]}
      />,
    );
    expect(screen.getByText('aaaa1111')).toBeInTheDocument();
    expect(screen.getByText('bbbb2222')).toBeInTheDocument();
  });
});
