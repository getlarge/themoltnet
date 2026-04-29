import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';

import { joinTextDeltas } from '../format.js';
import { TaskActionPanel } from '../task-action-panel.js';
import { TaskMessagesTimeline } from '../task-messages-timeline.js';
import { TaskQueueTable } from '../task-queue-table.js';
import { TaskStatusBadge } from '../task-status-badge.js';
import { attemptFixture, messagesFixture, taskFixture } from './fixtures.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider mode="light">{ui}</MoltThemeProvider>);
}

describe('@moltnet/task-ui', () => {
  it('renders task status with humanized labels', () => {
    renderWithTheme(<TaskStatusBadge status="timed_out" />);

    expect(screen.getByText('Timed Out')).toBeInTheDocument();
  });

  it('renders a queue table optimized for task scanning', () => {
    renderWithTheme(
      <TaskQueueTable
        tasks={[taskFixture]}
        renderDiaryLabel={(id) => `Diary ${id?.slice(0, 4)}`}
        renderAgentLabel={(id) => `Agent ${id?.slice(0, 4)}`}
      />,
    );

    expect(screen.getByText('Curate Pack')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Diary 3333')).toBeInTheDocument();
    expect(screen.getByText('Agent 5555')).toBeInTheDocument();
  });

  it('joins adjacent text deltas for readable attempt timelines', () => {
    const joined = joinTextDeltas(messagesFixture);

    expect(joined).toHaveLength(2);
    expect(joined[0]?.payload).toEqual({ text: 'Reading task context.' });
  });

  it('renders timeline text and tool-call payloads', () => {
    renderWithTheme(<TaskMessagesTimeline messages={messagesFixture} />);

    expect(screen.getByText('Reading task context.')).toBeInTheDocument();
    expect(screen.getByText('Tool Call Start')).toBeInTheDocument();
    expect(screen.getByText('Collapse JSON')).toBeInTheDocument();
  });

  it('produces deterministic agent prompts for task handoff', () => {
    renderWithTheme(
      <TaskActionPanel task={taskFixture} selectedAttempt={attemptFixture} />,
    );

    expect(screen.getAllByText(`@tasks_get id=${taskFixture.id}`)).toHaveLength(
      2,
    );
    expect(
      screen.getAllByText(
        `@tasks_messages_list task_id=${taskFixture.id} attempt_n=1`,
      ),
    ).toHaveLength(2);
    expect(screen.getByText('Open full console')).toBeInTheDocument();
  });
});
