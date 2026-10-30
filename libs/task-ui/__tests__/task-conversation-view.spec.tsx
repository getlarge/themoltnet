import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import {
  compareConversationMessages,
  operationalTaskMessages,
  type TaskConversationMessage,
  type TaskConversationThread,
  toConversationItems,
} from '../src/conversation.js';
import { TaskConversationView } from '../src/task-conversation-view.js';
import { TaskLivePane } from '../src/task-live-pane.js';
import type { TaskMessage } from '../src/types.js';
import { attemptFixture, messagesFixture, taskFixture } from './fixtures.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider mode="light">{ui}</MoltThemeProvider>);
}

function committed(
  entryId: number,
  message: Record<string, unknown>,
  overrides: Partial<TaskConversationMessage> = {},
): TaskConversationMessage {
  return {
    id: `${entryId}/0`,
    entryId: String(entryId),
    entryKind: 'pi.message',
    inherited: false,
    status: 'completed',
    message,
    ...overrides,
  };
}

function partial(
  text: string,
  status: 'streaming' | 'interrupted',
): TaskConversationMessage {
  return {
    id: 'partial/1',
    entryId: null,
    entryKind: 'pi.assistant',
    inherited: false,
    status,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

const assistantText = (text: string) => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
});
const toolCall = (id: string, name: string, args: unknown) => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name, arguments: args }],
});
const toolResult = (
  id: string,
  name: string,
  text: string,
  isError = false,
) => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: name,
  content: [{ type: 'text', text }],
  isError,
});

function mainThread(
  messages: TaskConversationMessage[],
  extra: Partial<TaskConversationThread> = {},
): TaskConversationThread {
  return {
    summary: { conversationId: '1', parentConversationId: null, kind: 'main' },
    messages,
    ...extra,
  };
}

function taskMessage(
  seq: number,
  kind: TaskMessage['kind'],
  payload: Record<string, unknown>,
): TaskMessage {
  return {
    taskId: taskFixture.id,
    attemptN: 1,
    seq,
    timestamp: '2026-04-27T10:02:00.000Z',
    kind,
    payload,
  };
}

describe('TaskConversationView', () => {
  it.each(['interrupted', 'failed'] as const)(
    'does not label a %s tool as running',
    (status) => {
      renderWithTheme(
        <TaskConversationView
          live
          threads={[
            mainThread([
              committed(1, toolCall('call', 'bash', {}), { status }),
            ]),
          ]}
        />,
      );
      expect(screen.queryByText('Running')).not.toBeInTheDocument();
      expect(
        screen.getByText(status === 'failed' ? 'Failed' : 'Interrupted'),
      ).toBeInTheDocument();
    },
  );

  it('lets an observed terminal snapshot override a stale live prop', () => {
    renderWithTheme(
      <TaskConversationView
        live
        threads={[
          mainThread([committed(1, toolCall('call', 'bash', {}))], {
            live: false,
          }),
        ]}
      />,
    );
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(screen.getByText('No result')).toBeInTheDocument();
  });

  it('releases child subscriptions when the conversation view unmounts', async () => {
    const onExpandedChange = vi.fn();
    const view = renderWithTheme(
      <TaskConversationView
        threads={[
          mainThread([]),
          {
            summary: {
              conversationId: '2',
              parentConversationId: '1',
              kind: 'subagent',
            },
            messages: [],
            onExpandedChange,
          },
        ]}
      />,
    );
    const details = screen
      .getByText('Subagent conversation 2')
      .closest('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await waitFor(() => expect(onExpandedChange).toHaveBeenCalledWith(true));
    // Use the latest callback without treating ordinary rerenders as closure.
    const latest = vi.fn();
    view.rerender(
      <MoltThemeProvider mode="light">
        <TaskConversationView
          threads={[
            mainThread([]),
            {
              summary: {
                conversationId: '2',
                parentConversationId: '1',
                kind: 'subagent',
              },
              messages: [],
              onExpandedChange: latest,
            },
          ]}
        />
      </MoltThemeProvider>,
    );
    expect(latest).not.toHaveBeenCalled();
    view.unmount();
    expect(latest).toHaveBeenCalledWith(false);
  });

  it('renders assistant text', () => {
    renderWithTheme(
      <TaskConversationView
        threads={[
          mainThread([
            committed(1, { role: 'user', content: 'Summarise the diff' }),
            committed(2, assistantText('The diff renames one module.')),
          ]),
        ]}
      />,
    );

    expect(screen.getByText('Summarise the diff')).toBeInTheDocument();
    expect(
      screen.getByText('The diff renames one module.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
  });

  it('renders a tool call once, with its result', () => {
    renderWithTheme(
      <TaskConversationView
        threads={[
          mainThread([
            committed(1, toolCall('call-1', 'read_file', { path: 'a.ts' })),
            committed(
              2,
              toolResult('call-1', 'read_file', 'export const a = 1'),
            ),
          ]),
        ]}
      />,
    );

    expect(screen.getAllByText('read_file')).toHaveLength(1);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('export const a = 1')).toBeInTheDocument();
    expect(screen.queryByText('Tool result')).not.toBeInTheDocument();
  });

  it('marks an error tool result', () => {
    renderWithTheme(
      <TaskConversationView
        threads={[
          mainThread([
            committed(1, toolCall('call-1', 'bash', { command: 'false' })),
            committed(2, toolResult('call-1', 'bash', 'exit status 1', true)),
          ]),
        ]}
      />,
    );

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('exit status 1')).toBeInTheDocument();
  });

  it('shows a streaming partial response and announces only the stream state', () => {
    renderWithTheme(
      <TaskConversationView
        live
        threads={[
          mainThread([
            committed(1, assistantText('Done reading.')),
            partial('Now writing the', 'streaming'),
          ]),
        ]}
      />,
    );

    expect(screen.getByText('Now writing the')).toBeInTheDocument();
    expect(screen.getByText('Streaming')).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Agent is responding.');
    expect(status).not.toHaveTextContent('Now writing the');
  });

  it('shows an interrupted partial as interrupted, not as live typing', () => {
    renderWithTheme(
      <TaskConversationView
        live
        threads={[mainThread([partial('Half a sent', 'interrupted')])]}
      />,
    );

    expect(screen.getByText('Interrupted')).toBeInTheDocument();
    expect(screen.queryByText('Streaming')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'The runtime stopped before this response was committed.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Agent response was interrupted.',
    );
  });

  it('groups inherited messages apart from this attempt', () => {
    renderWithTheme(
      <TaskConversationView
        threads={[
          mainThread([
            committed(1, assistantText('Work from attempt 1'), {
              inherited: true,
            }),
            committed(2, assistantText('Work from attempt 2')),
          ]),
        ]}
      />,
    );

    const group = screen
      .getByText('Context from earlier attempts')
      .closest('details');
    expect(group).not.toBeNull();
    expect(group).not.toHaveAttribute('open');
    expect(within(group!).getByText('Work from attempt 1')).toBeInTheDocument();
    expect(group).toHaveTextContent('1 message, not part of this attempt');
    const own = screen.getByText('Work from attempt 2');
    expect(own.closest('details')).toBeNull();
  });

  it('renders subagent conversations as collapsible threads', () => {
    renderWithTheme(
      <TaskConversationView
        threads={[
          mainThread([committed(1, assistantText('Delegating.'))]),
          {
            summary: {
              conversationId: '7',
              parentConversationId: '1',
              kind: 'subagent',
            },
            messages: [committed(3, assistantText('Subagent finding'))],
          },
        ]}
      />,
    );

    const thread = screen
      .getByText('Subagent conversation 7')
      .closest('details');
    expect(thread).not.toBeNull();
    expect(thread).not.toHaveAttribute('open');
    expect(within(thread!).getByText('Subagent finding')).toBeInTheDocument();
    expect(screen.getByText('Delegating.').closest('details')).toBeNull();
  });

  it('offers older history only when a cursor exists', () => {
    const onLoadOlder = vi.fn();
    renderWithTheme(
      <TaskConversationView
        threads={[
          mainThread([committed(101, assistantText('Latest'))], {
            onLoadOlder,
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });
});

describe('TaskLivePane conversation source', () => {
  it('keeps rendering text_delta transcripts for pre-Durable attempts', () => {
    renderWithTheme(
      <TaskLivePane
        task={taskFixture}
        attempt={attemptFixture}
        messages={messagesFixture}
        conversation={undefined}
      />,
    );

    expect(screen.getByText('Reading task context.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Events/ })).toBeNull();
  });

  it('falls back to task messages when the conversation is empty', () => {
    renderWithTheme(
      <TaskLivePane
        task={taskFixture}
        attempt={attemptFixture}
        messages={messagesFixture}
        conversation={[mainThread([])]}
      />,
    );

    expect(screen.getByText('Reading task context.')).toBeInTheDocument();
  });

  it('keeps initial read failures visible instead of displaying the legacy transcript', () => {
    const retry = vi.fn();
    renderWithTheme(
      <TaskLivePane
        task={taskFixture}
        messages={messagesFixture}
        conversation={[{ ...mainThread([]), error: true, onRetry: retry }]}
      />,
    );
    expect(
      screen.getByText('This conversation could not be loaded.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Reading task context.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry conversation' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows retrying before the first snapshot and preserves stale content after later failures', () => {
    const view = renderWithTheme(
      <TaskConversationView
        threads={[{ ...mainThread([]), loading: true, retrying: true }]}
      />,
    );
    expect(
      screen.getByText('Live updates unavailable. Retrying…'),
    ).toBeInTheDocument();
    view.rerender(
      <MoltThemeProvider mode="light">
        <TaskConversationView
          threads={[
            {
              ...mainThread([committed(1, assistantText('Last known answer'))]),
              error: true,
            },
          ]}
        />
      </MoltThemeProvider>,
    );
    expect(screen.getByText('Last known answer')).toBeInTheDocument();
    expect(
      screen.getByText('This conversation could not be loaded.'),
    ).toBeInTheDocument();
  });

  it('shows the conversation and moves operational events to their own tab', () => {
    const messages = [
      taskMessage(0, 'tool_call_start', { tool_name: 'read_file' }),
      taskMessage(1, 'tool_call_end', { tool_name: 'read_file' }),
      taskMessage(2, 'turn_end', { stop_reason: 'toolUse' }),
      taskMessage(3, 'error', { message: 'Provider overloaded' }),
      taskMessage(4, 'tool_policy_decision', { decision: 'deny' }),
    ];
    renderWithTheme(
      <TaskLivePane
        task={taskFixture}
        attempt={attemptFixture}
        messages={messages}
        conversation={[
          mainThread([
            committed(1, toolCall('call-1', 'read_file', { path: 'a.ts' })),
            committed(2, toolResult('call-1', 'read_file', 'contents')),
          ]),
        ]}
      />,
    );

    expect(screen.getAllByText('read_file')).toHaveLength(1);
    expect(screen.queryByText('Provider overloaded')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Events (2, 1 error)' }));
    expect(screen.getByText('Provider overloaded')).toBeInTheDocument();
    expect(screen.queryByText(/Tool Call Start/)).toBeNull();
  });
});

describe('conversation helpers', () => {
  it('keeps only operational task messages', () => {
    const kinds = operationalTaskMessages([
      taskMessage(0, 'text_delta', { text: 'x' }),
      taskMessage(1, 'tool_call_start', {}),
      taskMessage(2, 'tool_call_end', {}),
      taskMessage(3, 'turn_end', {}),
      taskMessage(4, 'error', {}),
      taskMessage(5, 'info', {}),
      taskMessage(6, 'tool_policy_decision', {}),
    ]).map((message) => message.kind);

    expect(kinds).toEqual(['error', 'info', 'tool_policy_decision']);
  });

  it('renders a result whose call is outside the window on its own', () => {
    const items = toConversationItems([
      committed(5, toolResult('gone', 'bash', 'late output')),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.blocks[0]).toMatchObject({
      type: 'toolResult',
      name: 'bash',
      text: 'late output',
    });
  });

  it('orders by entry and keeps the partial last', () => {
    const sorted = [
      partial('p', 'streaming'),
      committed(10, assistantText('b')),
      committed(9, assistantText('a')),
    ].sort(compareConversationMessages);

    expect(sorted.map((m) => m.id)).toEqual(['9/0', '10/0', 'partial/1']);
  });
});
