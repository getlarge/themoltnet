import { Stack, Text, useTheme } from '@themoltnet/design-system';
import { useState } from 'react';

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
}

export function TaskLivePane({
  task,
  attempt,
  messages,
  learnMoreHref,
}: TaskLivePaneProps) {
  const theme = useTheme();
  const [tab, setTab] = useState<PaneTab>('turns');
  const live = task.status === 'running' || task.status === 'dispatched';

  return (
    <div
      style={{
        background: theme.color.bg.void,
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.lg,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 480,
        position: 'sticky',
        top: theme.spacing[6],
      }}
    >
      <Stack
        direction="row"
        align="center"
        justify="space-between"
        gap={2}
        style={{
          padding: theme.spacing[3],
          borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
          background: theme.color.bg.surface,
        }}
      >
        <Stack direction="row" align="center" gap={2}>
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
        <TaskStatusBadge status={task.status} />
      </Stack>

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
                tab === entry.id ? theme.color.primary.DEFAULT : 'transparent'
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
    </div>
  );
}
