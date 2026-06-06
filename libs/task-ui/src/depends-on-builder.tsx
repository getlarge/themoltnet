import {
  Button,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect, useMemo, useRef, useState } from 'react';

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
  /**
   * Optional server-backed task search. When present, the picker calls this
   * after a short debounce as the user types. The local candidates still back
   * the empty-query recent list and are used as a fallback if search fails.
   */
  onSearchCandidates?: (query: string) => Promise<TaskSummary[]>;
  rows: DependsRow[];
  onChange: (rows: DependsRow[]) => void;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function DependsOnBuilder({
  candidates,
  availableTypes,
  onSearchCandidates,
  rows,
  onChange,
}: DependsOnBuilderProps) {
  const theme = useTheme();
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchedCandidates, setSearchedCandidates] = useState<TaskSummary[]>(
    [],
  );
  const [selectedCandidates, setSelectedCandidates] = useState<TaskSummary[]>(
    [],
  );
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const searchSeq = useRef(0);

  const normalizedQuery = searchQuery.trim();

  useEffect(() => {
    if (!onSearchCandidates || normalizedQuery === '') {
      searchSeq.current += 1;
      setSearchedCandidates([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const seq = ++searchSeq.current;
    setIsSearching(true);
    setSearchError(null);
    const handle = window.setTimeout(() => {
      onSearchCandidates(normalizedQuery)
        .then((items) => {
          if (seq !== searchSeq.current) return;
          setSearchedCandidates(items);
          setActiveIndex(0);
        })
        .catch(() => {
          if (seq !== searchSeq.current) return;
          setSearchedCandidates([]);
          setSearchError('Search failed');
        })
        .finally(() => {
          if (seq === searchSeq.current) setIsSearching(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(handle);
    };
  }, [normalizedQuery, onSearchCandidates]);

  const candidateSource =
    normalizedQuery && onSearchCandidates ? searchedCandidates : candidates;

  const visibleCandidates = useMemo(
    () =>
      typeFilter.length === 0
        ? candidateSource
        : candidateSource.filter((task) => typeFilter.includes(task.taskType)),
    [candidateSource, typeFilter],
  );

  const selectedTaskLabels = useMemo(
    () =>
      new Map(
        [...candidates, ...searchedCandidates, ...selectedCandidates].map(
          (task) => [task.id, formatTaskOption(task)],
        ),
      ),
    [candidates, searchedCandidates, selectedCandidates],
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
  function selectCandidate(task: TaskSummary) {
    addRow(task.id);
    setSelectedCandidates((items) =>
      items.some((item) => item.id === task.id) ? items : [...items, task],
    );
    setSearchQuery('');
    setActiveIndex(0);
    setIsPickerOpen(false);
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

  const exactTaskId = normalizedQuery;
  const exactTaskIdValid = UUID_RE.test(exactTaskId);
  const hasCandidates = visibleCandidates.length > 0;
  const boundedActiveIndex =
    hasCandidates && activeIndex >= visibleCandidates.length ? 0 : activeIndex;
  const showCandidateList =
    isPickerOpen && (normalizedQuery !== '' || hasCandidates || isSearching);

  return (
    <Stack gap={2}>
      <Text variant="caption" color="muted">
        Depends on (optional) — this task stays pending until each prerequisite
        is met. Prerequisites are limited to in-flight and completed tasks; use
        “add by id” for anything else.
      </Text>

      <Stack direction="row" gap={2} align="center" wrap>
        <TaskTypeFacet
          availableTypes={availableTypes}
          selected={typeFilter}
          onChange={setTypeFilter}
        />
      </Stack>

      <Stack gap={1}>
        <div style={{ position: 'relative', maxWidth: 520 }}>
          <Input
            aria-label="Search prerequisite tasks"
            aria-autocomplete="list"
            aria-controls="depends-on-task-options"
            aria-expanded={showCandidateList}
            autoComplete="off"
            inputSize="sm"
            placeholder="Search by title, tag, type, id, or correlation id"
            role="combobox"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setActiveIndex(0);
              setIsPickerOpen(true);
            }}
            onFocus={() => setIsPickerOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIsPickerOpen(true);
                setActiveIndex((index) =>
                  hasCandidates
                    ? Math.min(index + 1, visibleCandidates.length - 1)
                    : 0,
                );
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIsPickerOpen(true);
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter' && hasCandidates) {
                event.preventDefault();
                selectCandidate(visibleCandidates[boundedActiveIndex]);
              } else if (event.key === 'Escape') {
                setIsPickerOpen(false);
              }
            }}
          />
          {showCandidateList ? (
            <div
              id="depends-on-task-options"
              role="listbox"
              style={{
                background: theme.color.bg.surface,
                border: `1px solid ${theme.color.border.DEFAULT}`,
                borderRadius: theme.radius.md,
                boxShadow: theme.shadow.md,
                left: 0,
                marginTop: theme.spacing[1],
                maxHeight: 240,
                overflowY: 'auto',
                position: 'absolute',
                right: 0,
                zIndex: 20,
              }}
            >
              {isSearching ? (
                <div style={{ padding: theme.spacing[3] }}>
                  <Text variant="caption" color="muted">
                    Searching…
                  </Text>
                </div>
              ) : searchError ? (
                <div style={{ padding: theme.spacing[3] }}>
                  <Text
                    variant="caption"
                    style={{ color: theme.color.error.DEFAULT }}
                  >
                    {searchError}
                  </Text>
                </div>
              ) : hasCandidates ? (
                visibleCandidates.map((task, index) => (
                  <button
                    key={task.id}
                    role="option"
                    aria-selected={index === boundedActiveIndex}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectCandidate(task)}
                    onMouseEnter={() => setActiveIndex(index)}
                    style={{
                      background:
                        index === boundedActiveIndex
                          ? theme.color.bg.overlay
                          : theme.color.bg.surface,
                      border: 0,
                      borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
                      color: theme.color.text.DEFAULT,
                      cursor: 'pointer',
                      display: 'block',
                      font: 'inherit',
                      padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <TaskOptionLabel task={task} />
                  </button>
                ))
              ) : (
                <div style={{ padding: theme.spacing[3] }}>
                  <Text variant="caption" color="muted">
                    No matching tasks.
                  </Text>
                </div>
              )}
            </div>
          ) : null}
        </div>
        {exactTaskIdValid ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              addRow(exactTaskId);
              setSearchQuery('');
            }}
            style={{ alignSelf: 'flex-start' }}
          >
            Add pasted task id
          </Button>
        ) : null}
      </Stack>

      {rows.map((row, index) => (
        <Stack key={index} direction="row" gap={2} align="center" wrap>
          <div
            aria-label="Prerequisite task"
            style={{
              ...selectStyle,
              minWidth: 280,
              overflowWrap: 'anywhere',
            }}
          >
            {selectedTaskLabels.get(row.taskId) ?? row.taskId}
          </div>
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
    </Stack>
  );
}

function formatTaskOption(task: TaskSummary) {
  return `${task.taskType} · ${task.id.slice(0, 8)} · ${task.status}`;
}

function TaskOptionLabel({ task }: { task: TaskSummary }) {
  return (
    <Stack gap={0}>
      <Text variant="caption">{formatTaskOption(task)}</Text>
      {task.title ? (
        <Text variant="caption" color="muted">
          {task.title}
        </Text>
      ) : null}
    </Stack>
  );
}
