import { Stack, Text, useTheme } from '@themoltnet/design-system';

import { formatRelativeAge, humanizeToken } from './format.js';
import { TaskStatusBadge } from './task-status-badge.js';
import type { TaskLabelRenderer, TaskSummary } from './types.js';

export interface TaskQueueTableProps {
  tasks: TaskSummary[];
  now?: Date;
  selectedTaskId?: string;
  selectedTaskIds?: Set<string>;
  renderDiaryLabel?: TaskLabelRenderer;
  renderAgentLabel?: TaskLabelRenderer;
  onToggleTask?: (task: TaskSummary, selected: boolean) => void;
  onToggleVisible?: (selected: boolean) => void;
  onSelectTask?: (task: TaskSummary) => void;
  onOpenTask?: (task: TaskSummary) => void;
}

export function TaskQueueTable({
  tasks,
  now,
  selectedTaskId,
  selectedTaskIds,
  renderDiaryLabel,
  renderAgentLabel,
  onToggleTask,
  onToggleVisible,
  onSelectTask,
  onOpenTask,
}: TaskQueueTableProps) {
  const theme = useTheme();

  if (tasks.length === 0) {
    return (
      <Stack
        align="center"
        justify="center"
        style={{
          minHeight: 180,
          border: `1px dashed ${theme.color.border.DEFAULT}`,
          borderRadius: theme.radius.lg,
        }}
      >
        <Text color="muted">No visible tasks match this view.</Text>
      </Stack>
    );
  }

  const selectable = Boolean(onToggleTask);
  const visibleSelected =
    tasks.length > 0 && tasks.every((task) => selectedTaskIds?.has(task.id));
  const columns = `${selectable ? '40px ' : ''}minmax(190px, 1.3fr) minmax(110px, .7fr) minmax(170px, 1fr) minmax(190px, 1.4fr) minmax(120px, .9fr) minmax(130px, 1fr) minmax(90px, .6fr) minmax(70px, .5fr)`;

  return (
    <div
      style={{
        overflowX: 'auto',
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.lg,
      }}
    >
      <div style={{ minWidth: 980 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: columns,
            gap: theme.spacing[3],
            padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
            background: theme.color.bg.overlay,
            color: theme.color.text.secondary,
            fontSize: theme.font.size.xs,
            fontWeight: theme.font.weight.semibold,
            textTransform: 'uppercase',
          }}
        >
          {selectable ? (
            <input
              type="checkbox"
              aria-label="Select visible tasks"
              checked={visibleSelected}
              onChange={(event) => onToggleVisible?.(event.target.checked)}
            />
          ) : null}
          <span>Task</span>
          <span>Status</span>
          <span>Tags</span>
          <span>Correlation</span>
          <span>Diary</span>
          <span>Proposer</span>
          <span>Age</span>
          <span>Accepted</span>
        </div>
        {tasks.map((task) => {
          const selected = task.id === selectedTaskId;
          const checked = selectedTaskIds?.has(task.id) ?? false;
          return (
            <div
              key={task.id}
              style={{
                display: 'grid',
                gridTemplateColumns: columns,
                gap: theme.spacing[3],
                width: '100%',
                border: 'none',
                borderTop: `1px solid ${theme.color.border.DEFAULT}`,
                background: selected
                  ? theme.color.primary.subtle
                  : theme.color.bg.surface,
                color: theme.color.text.DEFAULT,
                font: 'inherit',
                padding: `${theme.spacing[3]} ${theme.spacing[3]}`,
                textAlign: 'left',
              }}
            >
              {selectable ? (
                <span>
                  <input
                    type="checkbox"
                    aria-label={`Select ${task.title || humanizeToken(task.taskType)}`}
                    checked={checked}
                    onChange={(event) =>
                      onToggleTask?.(task, event.target.checked)
                    }
                  />
                </span>
              ) : null}
              <span style={{ minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectTask?.(task);
                    onOpenTask?.(task);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: onSelectTask || onOpenTask ? 'pointer' : 'default',
                    display: 'block',
                    font: 'inherit',
                    fontWeight: theme.font.weight.semibold,
                    overflow: 'hidden',
                    padding: 0,
                    textAlign: 'left',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}
                >
                  {task.title || humanizeToken(task.taskType)}
                </button>
                <Text
                  variant="caption"
                  color="muted"
                  style={{ fontFamily: theme.font.family.mono }}
                >
                  {humanizeToken(task.taskType)} · {task.id.slice(0, 8)}
                </Text>
              </span>
              <span>
                <TaskStatusBadge status={task.status} />
              </span>
              <span style={{ minWidth: 0 }}>
                <Text
                  variant="caption"
                  color={task.tags.length > 0 ? undefined : 'muted'}
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {task.tags.length > 0
                    ? task.tags.map((tag) => `#${tag}`).join(' ')
                    : '—'}
                </Text>
              </span>
              <span
                title={task.correlationId ?? undefined}
                style={{ minWidth: 0 }}
              >
                <Text
                  variant="caption"
                  color={task.correlationId ? undefined : 'muted'}
                  style={{
                    fontFamily: task.correlationId
                      ? theme.font.family.mono
                      : undefined,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {task.correlationId ?? '—'}
                </Text>
              </span>
              <span>
                {renderDiaryLabel?.(task.diaryId) ?? task.diaryId ?? '—'}
              </span>
              <span>
                {renderAgentLabel?.(task.proposedByAgentId) ??
                  task.proposedByAgentId ??
                  task.proposedByHumanId ??
                  '—'}
              </span>
              <span title={task.queuedAt}>
                {formatRelativeAge(task.queuedAt, now)}
              </span>
              <span>{task.acceptedAttemptN ?? '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
