import { Stack, Text, useTheme } from '@themoltnet/design-system';

import { TASK_LANES, type TaskLane, type TaskLaneId } from './task-lanes.js';

type Theme = ReturnType<typeof useTheme>;

function toneColor(theme: Theme, tone: TaskLane['tone']): string {
  switch (tone) {
    case 'info':
      return theme.color.info.DEFAULT;
    case 'primary':
      return theme.color.primary.DEFAULT;
    case 'success':
      return theme.color.success.DEFAULT;
    case 'error':
      return theme.color.error.DEFAULT;
    case 'muted':
    default:
      return theme.color.text.muted;
  }
}

export interface TaskFunnelStripProps {
  counts: Record<TaskLaneId, number>;
}

export function TaskFunnelStrip({ counts }: TaskFunnelStripProps) {
  const theme = useTheme();
  return (
    <Stack
      direction="row"
      align="center"
      wrap
      style={{
        background: theme.color.bg.surface,
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.lg,
        padding: `${theme.spacing[3]} ${theme.spacing[4]}`,
      }}
    >
      {TASK_LANES.map((lane, index) => (
        <Stack key={lane.id} direction="row" align="center" gap={3}>
          <Stack
            gap={0.5}
            style={{ padding: `0 ${theme.spacing[4]}`, minWidth: 90 }}
          >
            <Text
              style={{
                fontSize: theme.font.size['2xl'],
                fontWeight: theme.font.weight.bold,
                color: toneColor(theme, lane.tone),
                lineHeight: 1,
              }}
            >
              {counts[lane.id]}
            </Text>
            <Text
              variant="caption"
              color="muted"
              style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              {lane.title}
            </Text>
          </Stack>
          {index < TASK_LANES.length - 1 ? (
            <Text color="muted" aria-hidden>
              →
            </Text>
          ) : null}
        </Stack>
      ))}
    </Stack>
  );
}
