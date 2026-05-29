import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';

import { TaskFunnelStrip } from '../task-funnel-strip.js';
import { TaskLaneBoard } from '../task-lane-board.js';
import { TaskLaneCard } from '../task-lane-card.js';
import { TaskLaneColumn } from '../task-lane-column.js';
import {
  groupTasksByLane,
  isTaskNonTerminal,
  statusToLane,
  TASK_LANES,
  TASK_NON_TERMINAL_STATUSES,
} from '../task-lanes.js';
import { TaskLivePane } from '../task-live-pane.js';
import { TaskTurnStream } from '../task-turn-stream.js';
import type { TaskStatus, TaskSummary } from '../types.js';
import { attemptFixture, messagesFixture, taskFixture } from './fixtures.js';

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

  it('treats pending and active statuses as non-terminal', () => {
    expect(TASK_NON_TERMINAL_STATUSES.sort()).toEqual(
      ['waiting', 'queued', 'dispatched', 'running'].sort(),
    );
    for (const s of ['waiting', 'queued', 'dispatched', 'running'] as const) {
      expect(isTaskNonTerminal(s)).toBe(true);
    }
    for (const s of ['completed', 'failed', 'cancelled', 'expired'] as const) {
      expect(isTaskNonTerminal(s)).toBe(false);
    }
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

describe('TaskLaneBoard', () => {
  it('renders all five lanes and places tasks by status', () => {
    renderWithTheme(
      <TaskLaneBoard
        tasks={[
          taskWith('queued', 'q1'),
          taskWith('running', 'r1'),
          taskWith('completed', 'd1'),
        ]}
      />,
    );
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('q1')).toBeInTheDocument();
    expect(screen.getByText('r1')).toBeInTheDocument();
    expect(screen.getByText('d1')).toBeInTheDocument();
  });
});

describe('TaskFunnelStrip', () => {
  it('shows a count per lane', () => {
    renderWithTheme(
      <TaskFunnelStrip
        counts={{ pending: 4, active: 3, done: 12, failed: 1, closed: 2 }}
      />,
    );
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});

describe('TaskTurnStream', () => {
  it('renders joined text and tool-call lines', () => {
    renderWithTheme(<TaskTurnStream messages={messagesFixture} />);
    expect(screen.getByText('Reading task context.')).toBeInTheDocument();
    expect(screen.getByText(/tool/i)).toBeInTheDocument();
  });

  it('shows a waiting hint when there are no messages', () => {
    renderWithTheme(<TaskTurnStream messages={[]} />);
    expect(screen.getByText(/waiting for the agent/i)).toBeInTheDocument();
  });
});

describe('TaskLivePane', () => {
  it('renders header, turns by default, and footer usage', () => {
    renderWithTheme(
      <TaskLivePane
        task={taskWith('running', 'abcdef1234')}
        attempt={attemptFixture}
        messages={messagesFixture}
      />,
    );
    expect(screen.getByText('Curate Pack')).toBeInTheDocument();
    expect(screen.getByText('Reading task context.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /turns/i })).toBeInTheDocument();
  });

  it('switches to the Input tab and renders the input viewer', () => {
    renderWithTheme(
      <TaskLivePane
        task={taskWith('running', 'abcdef1234')}
        attempt={attemptFixture}
        messages={messagesFixture}
      />,
    );
    const inputTab = screen.getByRole('tab', { name: /input/i });
    fireEvent.click(inputTab);
    expect(inputTab).toHaveAttribute('aria-selected', 'true');
    // JsonViewer renders defaultExpanded, so its collapse toggle is visible.
    expect(screen.getByText('Collapse JSON')).toBeInTheDocument();
  });
});
