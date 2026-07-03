import { Card, Text, useTheme } from '@themoltnet/design-system';
import { useState } from 'react';

import { formatInteger, formatPercent, formatRatio } from './format.js';
import type { TaskActivityAnalyticsGroup } from './types.js';

export interface MetricsTableProps {
  groups: TaskActivityAnalyticsGroup[];
  /** Called when a row is activated, for drilldown. */
  onSelectGroup?: (group: TaskActivityAnalyticsGroup) => void;
}

type SortKey =
  | 'label'
  | 'taskCount'
  | 'acceptedOutputRate'
  | 'firstAttemptAcceptedRate'
  | 'retryRecoveryRate'
  | 'attemptsPerAccepted'
  | 'medianTurns'
  | 'acceptedPer1k'
  | 'knowledgePerAccepted';

interface Column {
  key: SortKey;
  header: string;
  align: 'left' | 'right';
  value: (g: TaskActivityAnalyticsGroup) => string;
  sortValue: (g: TaskActivityAnalyticsGroup) => number | string;
}

const columns: Column[] = [
  {
    key: 'label',
    header: 'Cohort',
    align: 'left',
    value: (g) => g.label,
    sortValue: (g) => g.label,
  },
  {
    key: 'taskCount',
    header: 'Tasks',
    align: 'right',
    value: (g) => formatInteger(g.metrics.success.taskCount),
    sortValue: (g) => g.metrics.success.taskCount,
  },
  {
    key: 'acceptedOutputRate',
    header: 'Accepted',
    align: 'right',
    value: (g) => formatPercent(g.metrics.success.acceptedOutputRate),
    sortValue: (g) => g.metrics.success.acceptedOutputRate,
  },
  {
    key: 'firstAttemptAcceptedRate',
    header: 'First-try',
    align: 'right',
    value: (g) => formatPercent(g.metrics.success.firstAttemptAcceptedRate),
    sortValue: (g) => g.metrics.success.firstAttemptAcceptedRate,
  },
  {
    key: 'retryRecoveryRate',
    header: 'Retry rec.',
    align: 'right',
    value: (g) => formatPercent(g.metrics.success.retryRecoveryRate),
    sortValue: (g) => g.metrics.success.retryRecoveryRate,
  },
  {
    key: 'attemptsPerAccepted',
    header: 'Att./acc.',
    align: 'right',
    value: (g) => formatRatio(g.metrics.productivity.averageAttemptsPerAcceptedTask),
    sortValue: (g) => g.metrics.productivity.averageAttemptsPerAcceptedTask ?? Infinity,
  },
  {
    key: 'medianTurns',
    header: 'Turns',
    align: 'right',
    value: (g) => formatRatio(g.metrics.productivity.medianTurnsPerAttempt),
    sortValue: (g) => g.metrics.productivity.medianTurnsPerAttempt ?? Infinity,
  },
  {
    key: 'acceptedPer1k',
    header: 'Acc./1k tok',
    align: 'right',
    value: (g) => formatRatio(g.metrics.roi.acceptedTasksPerThousandTokens),
    sortValue: (g) => g.metrics.roi.acceptedTasksPerThousandTokens ?? -Infinity,
  },
  {
    key: 'knowledgePerAccepted',
    header: 'Know./acc.',
    align: 'right',
    value: (g) => formatRatio(g.metrics.knowledge.knowledgeCallsPerAcceptedTask),
    sortValue: (g) => g.metrics.knowledge.knowledgeCallsPerAcceptedTask ?? -Infinity,
  },
];

/**
 * The co-primary "which cohort performs best" table over `groups[]`. Columns
 * span all pillars (success, productivity, ROI, knowledge). Sortable; a row
 * click drills down. Renders an empty note when there are no groups (e.g.
 * `groupBy='none'`).
 */
export function MetricsTable({ groups, onSelectGroup }: MetricsTableProps) {
  const theme = useTheme();
  const [sortKey, setSortKey] = useState<SortKey>('acceptedOutputRate');
  const [asc, setAsc] = useState(false);

  if (groups.length === 0) {
    return (
      <Card variant="outlined" padding="md">
        <Text variant="caption" color="muted">
          Choose a “Compare by” dimension to break these metrics down by cohort.
        </Text>
      </Card>
    );
  }

  const column = columns.find((c) => c.key === sortKey) ?? columns[0];
  const sorted = [...groups].sort((a, b) => {
    const av = column.sortValue(a);
    const bv = column.sortValue(b);
    const cmp =
      typeof av === 'string' || typeof bv === 'string'
        ? String(av).localeCompare(String(bv))
        : av - bv;
    return asc ? cmp : -cmp;
  });

  function onHeaderClick(key: SortKey) {
    if (key === sortKey) {
      setAsc((v) => !v);
    } else {
      setSortKey(key);
      setAsc(false);
    }
  }

  const cellPad = `${theme.spacing[2]} ${theme.spacing[3]}`;

  return (
    <Card variant="outlined" padding="none">
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: theme.font.size.sm,
          }}
        >
          <thead>
            <tr>
              {columns.map((c) => {
                const active = c.key === sortKey;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      active ? (asc ? 'ascending' : 'descending') : 'none'
                    }
                    style={{
                      textAlign: c.align,
                      padding: cellPad,
                      borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
                      color: theme.color.text.secondary,
                      fontWeight: theme.font.weight.medium,
                      whiteSpace: 'nowrap',
                      position: 'sticky',
                      top: 0,
                      background: theme.color.bg.surface,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onHeaderClick(c.key)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: active
                          ? theme.color.primary.DEFAULT
                          : 'inherit',
                        font: 'inherit',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {c.header}
                      {active ? (asc ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => (
              <tr
                key={g.key}
                onClick={onSelectGroup ? () => onSelectGroup(g) : undefined}
                style={{
                  cursor: onSelectGroup ? 'pointer' : 'default',
                  borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
                }}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      textAlign: c.align,
                      padding: cellPad,
                      color: theme.color.text.DEFAULT,
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                      maxWidth: c.key === 'label' ? 220 : undefined,
                      overflow: c.key === 'label' ? 'hidden' : undefined,
                      textOverflow: c.key === 'label' ? 'ellipsis' : undefined,
                    }}
                  >
                    {c.value(g)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
