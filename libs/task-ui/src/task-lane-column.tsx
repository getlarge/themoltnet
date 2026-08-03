import { Button, Stack, Text, useTheme } from '@themoltnet/design-system';

import { TaskLaneCard } from './task-lane-card.js';
import type { TaskLane } from './task-lanes.js';
import type { TaskSummary } from './types.js';

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

export interface TaskLaneColumnProps {
  lane: TaskLane;
  tasks: TaskSummary[];
  /** Real total matching this lane (may exceed loaded tasks). Defaults to tasks.length. */
  total?: number;
  hasMore?: boolean;
  isLoading?: boolean;
  onLoadMore?: () => void;
  now?: Date;
  selectedTaskId?: string;
  onSelectTask?: (task: TaskSummary) => void;
}

export function TaskLaneColumn({
  lane,
  tasks,
  total,
  hasMore,
  isLoading,
  onLoadMore,
  now,
  selectedTaskId,
  onSelectTask,
}: TaskLaneColumnProps) {
  const theme = useTheme();
  const dot = toneColor(theme, lane.tone);
  const count = total ?? tasks.length;
  const headingId = `task-lane-${lane.id}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      style={{
        background: theme.color.bg.surface,
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.lg,
        display: 'flex',
        flexDirection: 'column',
        height: 'clamp(24rem, calc(100dvh - 18rem), 42rem)',
        minWidth: 0,
        overflow: 'hidden',
        scrollSnapAlign: 'start',
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
        }}
      >
        <Stack direction="row" align="center" gap={2}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: dot,
            }}
          />
          <Text
            as="h2"
            id={headingId}
            style={{
              fontWeight: theme.font.weight.semibold,
              textTransform: 'uppercase',
              fontSize: theme.font.size.xs,
              letterSpacing: '0.04em',
            }}
          >
            {lane.title}
          </Text>
        </Stack>
        <Text
          variant="caption"
          color="muted"
          style={{ fontFamily: theme.font.family.mono }}
        >
          {count}
        </Text>
      </Stack>
      <div
        aria-busy={isLoading || undefined}
        aria-label={`${lane.title} tasks`}
        role="region"
        tabIndex={tasks.length > 0 ? 0 : undefined}
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: theme.spacing[2],
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehaviorY: 'contain',
          padding: theme.spacing[3],
          scrollbarGutter: 'stable',
        }}
      >
        {tasks.length === 0 ? (
          <Text variant="caption" color="muted">
            No tasks
          </Text>
        ) : (
          tasks.map((task) => (
            <TaskLaneCard
              key={task.id}
              task={task}
              now={now}
              selected={task.id === selectedTaskId}
              onSelect={onSelectTask}
            />
          ))
        )}
        {hasMore && onLoadMore ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoading}
          >
            {isLoading ? 'Loading…' : 'Load more'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
