import { Stack, Text, useTheme } from '@themoltnet/design-system';

import { formatRelativeAge, humanizeToken } from './format.js';
import { TaskStatusBadge } from './task-status-badge.js';
import type { TaskLabelRenderer, TaskSummary } from './types.js';

export interface TaskQueueTableProps {
  tasks: TaskSummary[];
  now?: Date;
  selectedTaskId?: string;
  renderDiaryLabel?: TaskLabelRenderer;
  renderAgentLabel?: TaskLabelRenderer;
  onSelectTask?: (task: TaskSummary) => void;
  onOpenTask?: (task: TaskSummary) => void;
}

export function TaskQueueTable({
  tasks,
  now,
  selectedTaskId,
  renderDiaryLabel,
  renderAgentLabel,
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

  const columns =
    'minmax(150px, 1.2fr) minmax(110px, .8fr) minmax(120px, 1fr) minmax(130px, 1fr) minmax(90px, .6fr) minmax(70px, .5fr)';

  return (
    <div
      style={{
        overflowX: 'auto',
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.lg,
      }}
    >
      <div style={{ minWidth: 760 }}>
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
          <span>Type</span>
          <span>Status</span>
          <span>Diary</span>
          <span>Requester</span>
          <span>Age</span>
          <span>Accepted</span>
        </div>
        {tasks.map((task) => {
          const selected = task.id === selectedTaskId;
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => {
                onSelectTask?.(task);
                onOpenTask?.(task);
              }}
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
                cursor: onSelectTask || onOpenTask ? 'pointer' : 'default',
                font: 'inherit',
                padding: `${theme.spacing[3]} ${theme.spacing[3]}`,
                textAlign: 'left',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <Text
                  style={{
                    fontWeight: theme.font.weight.semibold,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {humanizeToken(task.taskType)}
                </Text>
                <Text
                  variant="caption"
                  color="muted"
                  style={{ fontFamily: theme.font.family.mono }}
                >
                  {task.id.slice(0, 8)}
                </Text>
              </span>
              <span>
                <TaskStatusBadge status={task.status} />
              </span>
              <span>
                {renderDiaryLabel?.(task.diaryId) ?? task.diaryId ?? '—'}
              </span>
              <span>
                {renderAgentLabel?.(task.imposedByAgentId) ??
                  task.imposedByAgentId ??
                  task.imposedByHumanId ??
                  '—'}
              </span>
              <span title={task.queuedAt}>
                {formatRelativeAge(task.queuedAt, now)}
              </span>
              <span>{task.acceptedAttemptN ?? '—'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
