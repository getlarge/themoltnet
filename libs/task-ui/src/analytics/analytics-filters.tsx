import { Stack, Text, useTheme } from '@themoltnet/design-system';

import { MultiSelectFacet } from './multi-select-facet.js';
import type {
  AnalyticsFilterOptions,
  AnalyticsFilters as Filters,
  AnalyticsGroupBy,
} from './types.js';

export interface AnalyticsFiltersProps {
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
  /** Host-supplied option lists; a facet renders only when its list is present. */
  filterOptions?: AnalyticsFilterOptions;
}

const GROUP_BY_OPTIONS: Array<{ value: AnalyticsGroupBy; label: string }> = [
  { value: 'none', label: 'No grouping' },
  { value: 'day', label: 'By day (trend)' },
  { value: 'tag', label: 'By tag' },
  { value: 'taskType', label: 'By task type' },
  { value: 'profile', label: 'By profile' },
  { value: 'diary', label: 'By diary' },
  { value: 'agent', label: 'By agent' },
  { value: 'providerModel', label: 'By model' },
];

/** Trim the date part from an ISO string for a native date input. */
function toDateInput(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** Expand a `yyyy-mm-dd` to an ISO instant; empty clears the field. */
function fromDateInput(
  value: string,
  boundary: 'start' | 'end',
): string | undefined {
  if (!value) return undefined;
  return boundary === 'start'
    ? `${value}T00:00:00.000Z`
    : `${value}T23:59:59.999Z`;
}

/**
 * Cohort filters: completion window + grouping first, then the multi-value
 * cohort facets (tags primary, then task type / profile / diary / agent, each
 * shown only when the host provides options). Pure controlled component — emits
 * the next `AnalyticsFilters` and never fetches.
 */
export function AnalyticsFilters({
  filters,
  onFiltersChange,
  filterOptions,
}: AnalyticsFiltersProps) {
  const theme = useTheme();

  function patch(next: Partial<Filters>) {
    onFiltersChange({ ...filters, ...next });
  }

  const dateInputStyle: React.CSSProperties = {
    padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    font: 'inherit',
    fontSize: theme.font.size.sm,
  };

  return (
    <Stack gap={3}>
      <Stack direction="row" gap={3} align="flex-end" wrap>
        <label style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing[1] }}>
          <Text variant="caption" color="muted">
            Completed after
          </Text>
          <input
            type="date"
            aria-label="Completed after"
            value={toDateInput(filters.completedAfter)}
            onChange={(e) =>
              patch({ completedAfter: fromDateInput(e.target.value, 'start') })
            }
            style={dateInputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing[1] }}>
          <Text variant="caption" color="muted">
            Completed before
          </Text>
          <input
            type="date"
            aria-label="Completed before"
            value={toDateInput(filters.completedBefore)}
            onChange={(e) =>
              patch({ completedBefore: fromDateInput(e.target.value, 'end') })
            }
            style={dateInputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing[1] }}>
          <Text variant="caption" color="muted">
            Compare by
          </Text>
          <select
            aria-label="Compare by"
            value={filters.groupBy ?? 'none'}
            onChange={(e) =>
              patch({ groupBy: e.target.value as AnalyticsGroupBy })
            }
            style={dateInputStyle}
          >
            {GROUP_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </Stack>

      <Stack direction="row" gap={2} wrap>
        {filterOptions?.tags ? (
          <MultiSelectFacet
            label="Tags"
            options={filterOptions.tags}
            selected={filters.tags ?? []}
            onChange={(tags) => patch({ tags })}
          />
        ) : null}
        {filterOptions?.taskTypes ? (
          <MultiSelectFacet
            label="Task type"
            options={filterOptions.taskTypes}
            selected={filters.taskTypes ?? []}
            onChange={(taskTypes) => patch({ taskTypes })}
          />
        ) : null}
        {filterOptions?.profiles ? (
          <MultiSelectFacet
            label="Profile"
            options={filterOptions.profiles}
            selected={filters.profileIds ?? []}
            onChange={(profileIds) => patch({ profileIds })}
          />
        ) : null}
        {filterOptions?.diaries ? (
          <MultiSelectFacet
            label="Diary"
            options={filterOptions.diaries}
            selected={filters.diaryIds ?? []}
            onChange={(diaryIds) => patch({ diaryIds })}
          />
        ) : null}
        {filterOptions?.agents ? (
          <MultiSelectFacet
            label="Agent"
            options={filterOptions.agents}
            selected={filters.claimedByAgentIds ?? []}
            onChange={(claimedByAgentIds) => patch({ claimedByAgentIds })}
          />
        ) : null}
      </Stack>
    </Stack>
  );
}
