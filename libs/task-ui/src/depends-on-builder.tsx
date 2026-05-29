import { Button, Stack, Text, useTheme } from '@themoltnet/design-system';
import { useMemo, useState } from 'react';

import type { DependsRow } from './claim-condition.js';
import { TASK_STATUSES } from './task-lanes.js';
import { TaskTypeFacet } from './task-type-facet.js';
import type { TaskStatus, TaskSummary } from './types.js';

export interface DependsOnBuilderProps {
  /**
   * Candidate prerequisite tasks — the app scopes these to selectable statuses
   * (non-terminal + completed).
   */
  candidates: TaskSummary[];
  /** Registered task-type names, for the in-picker type filter. */
  availableTypes: string[];
  rows: DependsRow[];
  onChange: (rows: DependsRow[]) => void;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function DependsOnBuilder({
  candidates,
  availableTypes,
  rows,
  onChange,
}: DependsOnBuilderProps) {
  const theme = useTheme();
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [pasteId, setPasteId] = useState('');

  const visibleCandidates = useMemo(
    () =>
      typeFilter.length === 0
        ? candidates
        : candidates.filter((task) => typeFilter.includes(task.taskType)),
    [candidates, typeFilter],
  );

  function update(index: number, patch: Partial<DependsRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function addRow(taskId: string) {
    onChange([...rows, { taskId, mode: 'status', statuses: ['completed'] }]);
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

  const pasteValid = UUID_RE.test(pasteId.trim());

  return (
    <Stack gap={2}>
      <Text variant="caption" color="muted">
        Depends on (optional) — this task stays pending until each prerequisite
        is met. Prerequisites are limited to in-flight and completed tasks; use
        “add by id” for anything else.
      </Text>

      {rows.map((row, index) => (
        <Stack key={index} direction="row" gap={2} align="center" wrap>
          <select
            aria-label="Prerequisite task"
            value={row.taskId}
            onChange={(event) => update(index, { taskId: event.target.value })}
            style={selectStyle}
          >
            {visibleCandidates.length === 0 ? (
              <option value={row.taskId}>{row.taskId || 'No tasks'}</option>
            ) : (
              visibleCandidates.map((task) => (
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
              {TASK_STATUSES.map((status) => (
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

      <Stack direction="row" gap={2} align="center" wrap>
        <TaskTypeFacet
          availableTypes={availableTypes}
          selected={typeFilter}
          onChange={setTypeFilter}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => addRow(visibleCandidates[0]?.id ?? '')}
          disabled={visibleCandidates.length === 0}
        >
          + Add prerequisite
        </Button>
      </Stack>

      <Stack direction="row" gap={2} align="center" wrap>
        <input
          aria-label="Paste a task id"
          placeholder="Paste a task id…"
          value={pasteId}
          onChange={(event) => setPasteId(event.target.value)}
          style={{ ...selectStyle, minWidth: 320 }}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!pasteValid}
          onClick={() => {
            addRow(pasteId.trim());
            setPasteId('');
          }}
        >
          Add by id
        </Button>
      </Stack>
    </Stack>
  );
}
