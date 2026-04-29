import { Badge } from '@themoltnet/design-system';

import { humanizeToken, taskStatusTone } from './format.js';
import type { TaskAttemptStatus, TaskStatus } from './types.js';

export interface TaskStatusBadgeProps {
  status: TaskStatus | TaskAttemptStatus;
}

export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  return (
    <Badge variant={taskStatusTone(status)}>{humanizeToken(status)}</Badge>
  );
}
