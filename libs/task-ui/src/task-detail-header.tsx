import {
  Button,
  Card,
  CopyButton,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { formatDateTime, humanizeToken } from './format.js';
import { TaskStatusBadge } from './task-status-badge.js';
import type { TaskLabelRenderer, TaskSummary } from './types.js';

export interface TaskDetailHeaderProps {
  task: TaskSummary;
  renderTeamLabel?: TaskLabelRenderer;
  renderDiaryLabel?: TaskLabelRenderer;
  renderActorLabel?: TaskLabelRenderer;
  onOpenConsole?: (task: TaskSummary) => void;
}

export function TaskDetailHeader({
  task,
  renderTeamLabel,
  renderDiaryLabel,
  renderActorLabel,
  onOpenConsole,
}: TaskDetailHeaderProps) {
  const theme = useTheme();
  const actorId = task.imposedByAgentId ?? task.imposedByHumanId;

  const facts = [
    ['Team', renderTeamLabel?.(task.teamId) ?? task.teamId],
    ['Diary', renderDiaryLabel?.(task.diaryId) ?? task.diaryId ?? '—'],
    ['Imposer', renderActorLabel?.(actorId) ?? actorId ?? '—'],
    ['Queued', formatDateTime(task.queuedAt)],
    ['Completed', formatDateTime(task.completedAt)],
    ['Expires', formatDateTime(task.expiresAt)],
  ] as const;

  return (
    <Card variant="outlined" padding="md">
      <Stack gap={4}>
        <Stack
          direction="row"
          justify="space-between"
          align="flex-start"
          gap={4}
          wrap
        >
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Stack direction="row" align="center" gap={2} wrap>
              <TaskStatusBadge status={task.status} />
              <Text variant="h2" style={{ margin: 0 }}>
                {humanizeToken(task.taskType)}
              </Text>
            </Stack>
            <Stack direction="row" gap={2} align="center" wrap>
              <Text
                variant="caption"
                color="muted"
                style={{ fontFamily: theme.font.family.mono }}
              >
                {task.id}
              </Text>
              <CopyButton value={task.id} label="Copy ID" />
            </Stack>
          </Stack>

          {task.consoleUrl && onOpenConsole ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onOpenConsole(task)}
            >
              Open full console
            </Button>
          ) : null}
        </Stack>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: theme.spacing[3],
          }}
        >
          {facts.map(([label, value]) => (
            <Stack key={label} gap={1}>
              <Text variant="caption" color="muted">
                {label}
              </Text>
              <Text
                style={{
                  overflowWrap: 'anywhere',
                  fontFamily:
                    typeof value === 'string' && value.includes('-')
                      ? theme.font.family.mono
                      : undefined,
                }}
              >
                {value}
              </Text>
            </Stack>
          ))}
        </div>
      </Stack>
    </Card>
  );
}
