import type { TaskStatus } from '@moltnet/api-client';
import type { TaskSummary } from '@moltnet/task-ui';
import { Button, Stack, Text, useTheme } from '@themoltnet/design-system';

import type { DependsRow } from '../../tasks/claim-condition.js';
import { TASK_STATUS_FILTERS } from '../../tasks/status.js';

export interface DependsOnBuilderProps {
  /** Candidate prerequisite tasks (current team). */
  candidates: TaskSummary[];
  rows: DependsRow[];
  onChange: (rows: DependsRow[]) => void;
}

export function DependsOnBuilder({
  candidates,
  rows,
  onChange,
}: DependsOnBuilderProps) {
  const theme = useTheme();

  function update(index: number, patch: Partial<DependsRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function addRow() {
    onChange([
      ...rows,
      {
        taskId: candidates[0]?.id ?? '',
        mode: 'status',
        statuses: ['completed'],
      },
    ]);
  }
  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  const selectStyle: React.CSSProperties = {
    padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    fontFamily: theme.font.family.sans,
    fontSize: theme.font.size.sm,
  };

  return (
    <Stack gap={2}>
      <Text variant="caption" color="muted">
        Depends on (optional) — this task stays pending until each prerequisite
        is met.
      </Text>
      {rows.map((row, index) => (
        <Stack key={index} direction="row" gap={2} align="center" wrap>
          <select
            aria-label="Prerequisite task"
            value={row.taskId}
            onChange={(event) => update(index, { taskId: event.target.value })}
            style={selectStyle}
          >
            {candidates.length === 0 ? (
              <option value="">No tasks available</option>
            ) : (
              candidates.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.taskType} · {task.id.slice(0, 8)}
                </option>
              ))
            )}
          </select>
          <select
            aria-label="Condition"
            value={row.mode}
            onChange={(event) =>
              update(index, { mode: event.target.value as DependsRow['mode'] })
            }
            style={selectStyle}
          >
            <option value="status">reaches status</option>
            <option value="accepted">is accepted</option>
          </select>
          {row.mode === 'status' ? (
            <select
              aria-label="Status"
              value={row.statuses?.[0] ?? 'completed'}
              onChange={(event) =>
                update(index, { statuses: [event.target.value as TaskStatus] })
              }
              style={selectStyle}
            >
              {TASK_STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => removeRow(index)}>
            Remove
          </Button>
        </Stack>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={addRow}
        disabled={candidates.length === 0}
      >
        + Add prerequisite
      </Button>
    </Stack>
  );
}
