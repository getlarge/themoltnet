import { Text, useTheme } from '@themoltnet/design-system';

import { formatDateTime } from './format.js';
import { TaskStatusBadge } from './task-status-badge.js';
import type { TaskAttemptSummary, TaskLabelRenderer } from './types.js';

export interface TaskAttemptsTableProps {
  attempts: TaskAttemptSummary[];
  selectedAttemptN?: number;
  renderAgentLabel?: TaskLabelRenderer;
  onSelectAttempt?: (attempt: TaskAttemptSummary) => void;
}

export function TaskAttemptsTable({
  attempts,
  selectedAttemptN,
  renderAgentLabel,
  onSelectAttempt,
}: TaskAttemptsTableProps) {
  const theme = useTheme();

  if (attempts.length === 0) {
    return <Text color="muted">No attempts yet.</Text>;
  }

  const columns =
    '80px minmax(120px, 1fr) 120px minmax(140px, 1fr) minmax(140px, 1fr) 120px';

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
          <span>N</span>
          <span>Agent</span>
          <span>Status</span>
          <span>Started</span>
          <span>Completed</span>
          <span>Error</span>
        </div>
        {attempts.map((attempt) => (
          <button
            key={attempt.attemptN}
            type="button"
            onClick={() => onSelectAttempt?.(attempt)}
            style={{
              display: 'grid',
              gridTemplateColumns: columns,
              gap: theme.spacing[3],
              width: '100%',
              border: 'none',
              borderTop: `1px solid ${theme.color.border.DEFAULT}`,
              background:
                attempt.attemptN === selectedAttemptN
                  ? theme.color.primary.subtle
                  : theme.color.bg.surface,
              color: theme.color.text.DEFAULT,
              cursor: onSelectAttempt ? 'pointer' : 'default',
              font: 'inherit',
              padding: `${theme.spacing[3]} ${theme.spacing[3]}`,
              textAlign: 'left',
            }}
          >
            <span>{attempt.attemptN}</span>
            <span>
              {renderAgentLabel?.(attempt.claimedByAgentId) ??
                attempt.claimedByAgentId}
            </span>
            <span>
              <TaskStatusBadge status={attempt.status} />
            </span>
            <span>{formatDateTime(attempt.startedAt)}</span>
            <span>{formatDateTime(attempt.completedAt)}</span>
            <span>{attempt.error?.code ?? '—'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
