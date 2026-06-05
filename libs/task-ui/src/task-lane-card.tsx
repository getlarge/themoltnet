import { Stack, Text, useTheme } from '@themoltnet/design-system';

import { formatRelativeAge, humanizeToken } from './format.js';
import { TaskStatusBadge } from './task-status-badge.js';
import type { TaskSummary } from './types.js';

const ACTIVE_STATUSES = ['dispatched', 'running'];

export interface TaskLaneCardProps {
  task: TaskSummary;
  now?: Date;
  selected?: boolean;
  onSelect?: (task: TaskSummary) => void;
}

export function TaskLaneCard({
  task,
  now,
  selected,
  onSelect,
}: TaskLaneCardProps) {
  const theme = useTheme();
  const isActive = ACTIVE_STATUSES.includes(task.status);
  const prRef = task.references.find(
    (ref) => ref.external?.pr || ref.external?.issue,
  );
  const prLabel = prRef?.external?.pr
    ? `PR #${prRef.external.pr}`
    : prRef?.external?.issue
      ? `#${prRef.external.issue}`
      : null;
  const taskTitle = task.title || humanizeToken(task.taskType);

  return (
    <button
      type="button"
      onClick={() => onSelect?.(task)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        font: 'inherit',
        cursor: onSelect ? 'pointer' : 'default',
        background: theme.color.bg.elevated,
        color: theme.color.text.DEFAULT,
        border: `1px solid ${
          selected ? theme.color.primary.DEFAULT : theme.color.border.DEFAULT
        }`,
        borderRadius: theme.radius.md,
        padding: theme.spacing[3],
      }}
    >
      <Stack gap={1}>
        <Stack direction="row" align="center" gap={2}>
          {isActive ? <LivePulse /> : null}
          <Text style={{ fontWeight: theme.font.weight.semibold }}>
            {taskTitle}
          </Text>
        </Stack>
        <Text
          variant="caption"
          color="muted"
          style={{ fontFamily: theme.font.family.mono }}
        >
          {humanizeToken(task.taskType)} · {task.id.slice(0, 8)}
        </Text>
        {task.tags.length > 0 ? (
          <Stack direction="row" gap={1} wrap>
            {task.tags.slice(0, 4).map((tag) => (
              <Text
                key={tag}
                variant="caption"
                color="muted"
                style={{ fontFamily: theme.font.family.mono }}
              >
                #{tag}
              </Text>
            ))}
          </Stack>
        ) : null}
        <Stack
          direction="row"
          align="center"
          gap={2}
          wrap
          style={{ marginTop: theme.spacing[2] }}
        >
          <TaskStatusBadge status={task.status} />
          <Text variant="caption" color="muted">
            {formatRelativeAge(task.queuedAt, now)}
          </Text>
          {prLabel ? (
            <Text
              variant="caption"
              style={{
                color: theme.color.info.DEFAULT,
                fontFamily: theme.font.family.mono,
              }}
            >
              {prLabel}
            </Text>
          ) : null}
        </Stack>
      </Stack>
    </button>
  );
}

function LivePulse() {
  const theme = useTheme();
  return (
    <span
      aria-hidden
      style={{
        width: 7,
        height: 7,
        flex: 'none',
        borderRadius: '50%',
        background: theme.color.primary.DEFAULT,
      }}
    />
  );
}
