/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The overflow rail
 * needs a keyboard focus target so arrow-key users can pan between lanes. */
import { useTheme } from '@themoltnet/design-system';

import { TaskLaneColumn } from './task-lane-column.js';
import { TASK_LANES, type TaskLaneId } from './task-lanes.js';
import type { TaskSummary } from './types.js';

/** Per-lane data: the loaded page, the real total, and pagination state. */
export interface TaskLaneData {
  tasks: TaskSummary[];
  /** Real total matching this lane (may exceed loaded tasks). */
  total: number;
  hasMore?: boolean;
  isLoading?: boolean;
  onLoadMore?: () => void;
}

export interface TaskLaneBoardProps {
  /**
   * Per-lane data. Each lane is fetched independently (server-filtered by the
   * lane's statuses) so the board scales — it no longer groups one shared page
   * client-side. Lanes absent from the map render empty.
   */
  lanes: Partial<Record<TaskLaneId, TaskLaneData>>;
  now?: Date;
  selectedTaskId?: string;
  onSelectTask?: (task: TaskSummary) => void;
}

const EMPTY_LANE: TaskLaneData = { tasks: [], total: 0 };

export function TaskLaneBoard({
  lanes,
  now,
  selectedTaskId,
  onSelectTask,
}: TaskLaneBoardProps) {
  const theme = useTheme();

  return (
    <div
      aria-label="Task board lanes. Scroll horizontally to view every lifecycle state."
      role="region"
      tabIndex={0}
      style={{
        maxWidth: '100%',
        overflowX: 'auto',
        overscrollBehaviorX: 'contain',
        paddingBottom: theme.spacing[2],
        scrollPaddingInline: theme.spacing[1],
        scrollSnapType: 'x proximity',
        scrollbarGutter: 'stable',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div
        style={{
          alignItems: 'start',
          display: 'grid',
          gap: theme.spacing[3],
          gridAutoColumns: 'min(82vw, 18rem)',
          gridAutoFlow: 'column',
          width: 'max-content',
        }}
      >
        {TASK_LANES.map((lane) => {
          const data = lanes[lane.id] ?? EMPTY_LANE;
          return (
            <TaskLaneColumn
              key={lane.id}
              lane={lane}
              tasks={data.tasks}
              total={data.total}
              hasMore={data.hasMore}
              isLoading={data.isLoading}
              onLoadMore={data.onLoadMore}
              now={now}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
            />
          );
        })}
      </div>
    </div>
  );
}
