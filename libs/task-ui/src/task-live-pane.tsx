import { Stack, Text, useTheme } from '@themoltnet/design-system';
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useState,
} from 'react';

import { humanizeToken } from './format.js';
import { JsonViewer } from './json-viewer.js';
import { TaskStatusBadge } from './task-status-badge.js';
import { TaskTurnStream } from './task-turn-stream.js';
import type { TaskAttemptSummary, TaskMessage, TaskSummary } from './types.js';

type PaneTab = 'turns' | 'usage' | 'input';

const TABS: { id: PaneTab; label: string }[] = [
  { id: 'turns', label: 'Turns' },
  { id: 'usage', label: 'Usage' },
  { id: 'input', label: 'Input' },
];

export interface TaskLivePaneProps {
  task: TaskSummary;
  attempt?: TaskAttemptSummary | null;
  messages: TaskMessage[];
  /** Docs URL surfaced in the empty turn-stream state (run an agent daemon). */
  learnMoreHref?: string;
  /** Deselects or hides the pane in the parent view. */
  onClose?: () => void;
  /** Starts header-only; useful when the pane is stacked below content. */
  defaultCollapsed?: boolean;
}

export function TaskLivePane({
  task,
  attempt,
  messages,
  learnMoreHref,
  onClose,
  defaultCollapsed = false,
}: TaskLivePaneProps) {
  const theme = useTheme();
  const [tab, setTab] = useState<PaneTab>('turns');
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const live = task.status === 'running' || task.status === 'dispatched';

  useEffect(() => {
    setCollapsed(defaultCollapsed);
  }, [defaultCollapsed, task.id]);

  function toggleCollapsed() {
    setCollapsed((value) => !value);
  }

  function handleHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleCollapsed();
    }
  }

  function handleClose(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onClose?.();
  }

  return (
    <div
      style={{
        background: theme.color.bg.void,
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.lg,
        display: 'flex',
        flexDirection: 'column',
        minHeight: collapsed ? undefined : 480,
        position: 'sticky',
        top: theme.spacing[6],
        overflow: 'hidden',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
        onKeyDown={handleHeaderKeyDown}
        style={{
          alignItems: 'center',
          padding: theme.spacing[3],
          borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
          background: theme.color.bg.surface,
          cursor: 'pointer',
          display: 'flex',
          gap: theme.spacing[2],
          justifyContent: 'space-between',
        }}
      >
        <Stack direction="row" align="center" gap={2} style={{ minWidth: 0 }}>
          <Text style={{ fontWeight: theme.font.weight.semibold }}>
            {humanizeToken(task.taskType)}
          </Text>
          <Text
            variant="caption"
            color="muted"
            style={{ fontFamily: theme.font.family.mono }}
          >
            {task.id.slice(0, 8)}
            {attempt ? ` · attempt ${attempt.attemptN}` : ''}
          </Text>
        </Stack>
        <Stack direction="row" align="center" gap={2}>
          <TaskStatusBadge status={task.status} />
          <Text
            aria-hidden="true"
            color="muted"
            style={{
              fontFamily: theme.font.family.mono,
              fontSize: theme.font.size.sm,
              lineHeight: 1,
              width: '1rem',
              textAlign: 'center',
            }}
          >
            {collapsed ? '+' : '-'}
          </Text>
          {onClose ? (
            <button
              type="button"
              aria-label="Close task live pane"
              onClick={handleClose}
              style={{
                alignItems: 'center',
                background: 'transparent',
                border: `1px solid ${theme.color.border.DEFAULT}`,
                borderRadius: theme.radius.sm,
                color: theme.color.text.secondary,
                cursor: 'pointer',
                display: 'inline-flex',
                font: 'inherit',
                fontFamily: theme.font.family.mono,
                height: '1.75rem',
                justifyContent: 'center',
                padding: 0,
                width: '1.75rem',
              }}
            >
              X
            </button>
          ) : null}
        </Stack>
      </div>

      {collapsed ? null : (
        <>
          <div
            role="tablist"
            style={{
              display: 'flex',
              borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
              background: theme.color.bg.surface,
            }}
          >
            {TABS.map((entry) => (
              <button
                key={entry.id}
                role="tab"
                aria-selected={tab === entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                style={{
                  font: 'inherit',
                  fontFamily: theme.font.family.mono,
                  fontSize: theme.font.size.xs,
                  padding: `${theme.spacing[2]} ${theme.spacing[4]}`,
                  cursor: 'pointer',
                  background: 'transparent',
                  color:
                    tab === entry.id
                      ? theme.color.primary.DEFAULT
                      : theme.color.text.secondary,
                  border: 'none',
                  borderBottom: `2px solid ${
                    tab === entry.id
                      ? theme.color.primary.DEFAULT
                      : 'transparent'
                  }`,
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {tab === 'turns' ? (
              <TaskTurnStream
                messages={messages}
                live={live}
                learnMoreHref={learnMoreHref}
              />
            ) : null}
            {tab === 'usage' ? (
              <div style={{ padding: theme.spacing[4] }}>
                <JsonViewer value={attempt?.usage ?? {}} defaultExpanded />
              </div>
            ) : null}
            {tab === 'input' ? (
              <div style={{ padding: theme.spacing[4] }}>
                <JsonViewer value={task.input} defaultExpanded />
              </div>
            ) : null}
          </div>

          {attempt?.usage ? (
            <Stack
              direction="row"
              gap={4}
              style={{
                padding: theme.spacing[3],
                borderTop: `1px solid ${theme.color.border.DEFAULT}`,
                background: theme.color.bg.surface,
                fontFamily: theme.font.family.mono,
              }}
            >
              <Text variant="caption" color="muted">
                {attempt.usage.inputTokens + attempt.usage.outputTokens} tok
              </Text>
              {typeof attempt.usage.toolCalls === 'number' ? (
                <Text variant="caption" color="muted">
                  tools {attempt.usage.toolCalls}
                </Text>
              ) : null}
              {attempt.usage.model ? (
                <Text variant="caption" color="muted">
                  {attempt.usage.model}
                </Text>
              ) : null}
            </Stack>
          ) : null}
        </>
      )}
    </div>
  );
}
