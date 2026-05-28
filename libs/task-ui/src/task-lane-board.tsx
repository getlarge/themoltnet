import { useTheme } from '@themoltnet/design-system';

import { TaskLaneColumn } from './task-lane-column.js';
import { groupTasksByLane, TASK_LANES } from './task-lanes.js';
import type { TaskSummary } from './types.js';

export interface TaskLaneBoardProps {
  tasks: TaskSummary[];
  now?: Date;
  selectedTaskId?: string;
  onSelectTask?: (task: TaskSummary) => void;
}

export function TaskLaneBoard({
  tasks,
  now,
  selectedTaskId,
  onSelectTask,
}: TaskLaneBoardProps) {
  const theme = useTheme();
  const grouped = groupTasksByLane(tasks);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: theme.spacing[3],
        alignItems: 'start',
      }}
    >
      {TASK_LANES.map((lane) => (
        <TaskLaneColumn
          key={lane.id}
          lane={lane}
          tasks={grouped[lane.id]}
          now={now}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
        />
      ))}
    </div>
  );
}
