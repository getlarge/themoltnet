import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';

import { formatRelativeAge, humanizeToken } from './format.js';
import { TaskStatusBadge } from './task-status-badge.js';
import type { TaskAttemptSummary, TaskSummary } from './types.js';

export interface TaskSummaryStripProps {
  task: TaskSummary;
  latestAttempt?: TaskAttemptSummary | null;
  now?: Date;
  onOpenTask?: (task: TaskSummary) => void;
}

export function TaskSummaryStrip({
  task,
  latestAttempt,
  now,
  onOpenTask,
}: TaskSummaryStripProps) {
  const theme = useTheme();

  return (
    <Card
      variant="outlined"
      padding="sm"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: theme.spacing[3],
        alignItems: 'center',
      }}
    >
      <Stack gap={1} style={{ minWidth: 0 }}>
        <Stack direction="row" align="center" gap={2} wrap>
          <TaskStatusBadge status={task.status} />
          <Text style={{ fontWeight: theme.font.weight.semibold }}>
            {humanizeToken(task.taskType)}
          </Text>
          <Text variant="caption" color="muted">
            {formatRelativeAge(task.queuedAt, now)}
          </Text>
        </Stack>
        <Text
          variant="caption"
          color="muted"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {latestAttempt
            ? `Attempt ${latestAttempt.attemptN} by ${latestAttempt.claimedByAgentId}`
            : `No attempts yet · ${task.id}`}
        </Text>
      </Stack>

      {onOpenTask ? (
        <button
          type="button"
          onClick={() => onOpenTask(task)}
          style={{
            border: `1px solid ${theme.color.border.DEFAULT}`,
            borderRadius: theme.radius.md,
            background: 'transparent',
            color: theme.color.primary.DEFAULT,
            cursor: 'pointer',
            font: 'inherit',
            fontSize: theme.font.size.sm,
            padding: `${theme.spacing[1]} ${theme.spacing[2]}`,
          }}
        >
          Open
        </button>
      ) : null}
    </Card>
  );
}
