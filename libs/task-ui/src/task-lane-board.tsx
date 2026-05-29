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
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: theme.spacing[3],
        alignItems: 'start',
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
  );
}
