import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';

import { joinTextDeltas } from '../format.js';
import { TaskActionPanel } from '../task-action-panel.js';
import { TaskDetailHeader } from '../task-detail-header.js';
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
    const { container } = renderWithTheme(
      <TaskQueueTable
        tasks={[taskFixture]}
        renderDiaryLabel={(id) => `Diary ${id?.slice(0, 4)}`}
        renderAgentLabel={(id) => `Agent ${id?.slice(0, 4)}`}
      />,
    );

    expect(screen.getByText('Curate task UI context')).toBeInTheDocument();
    expect(container).toHaveTextContent('Curate Pack');
    expect(container).toHaveTextContent('11111111');
    expect(container).toHaveTextContent('#task-ui #observability');
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText(taskFixture.correlationId!)).toBeInTheDocument();
    expect(screen.getByText('Diary 3333')).toBeInTheDocument();
    expect(screen.getByText('Agent 5555')).toBeInTheDocument();
  });

  it('clips long table tokens inside their columns', () => {
    const longTask = {
      ...taskFixture,
      title:
        'Judge traffic fit eval: no-tracking-clear-offer / baseline-no-skill',
      tags: [
        'traffic-fit',
        'eval-judge',
        'no-tracking-clear-offer',
        'baseline-no-skill',
      ],
      correlationId: '2c3dd3ff-ca01-41e2-8794-2a6188d1f462',
      diaryId: 'e5c15e6e-339e-4247-8345-5ea7d4142997',
      proposedByAgentId: 'a854b555-aeef-4f13-ab22-8d0b819d478e',
    };

    const { container } = renderWithTheme(
      <TaskQueueTable tasks={[longTask]} />,
    );
    const table = container.querySelector('[style*="min-width: 1180px"]');

    expect(table).toHaveStyle({ minWidth: '1180px' });
    expect(screen.getByText(longTask.correlationId)).toHaveStyle({
      display: 'block',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    expect(screen.getByText(longTask.diaryId)).toHaveStyle({
      display: 'block',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    expect(
      screen.getByText(
        '#traffic-fit #eval-judge #no-tracking-clear-offer #baseline-no-skill',
      ),
    ).toHaveStyle({
      display: 'block',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
  });

  it('renders the correlation id in the task detail header', () => {
    renderWithTheme(<TaskDetailHeader task={taskFixture} />);

    expect(screen.getByText('Correlation ID')).toBeInTheDocument();
    expect(screen.getAllByText(taskFixture.correlationId!)).toHaveLength(2);
    expect(screen.getByText('Copy correlation ID')).toBeInTheDocument();
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
