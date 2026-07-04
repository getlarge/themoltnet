import { Button, Card, Stack, Text, useTheme } from '@themoltnet/design-system';

import { AnalyticsFilters } from './analytics-filters.js';
import { Sparkline, type SparklinePoint } from './charts/sparkline.js';
import { HurdlesPanel } from './hurdles-panel.js';
import { KnowledgeUsagePanel } from './knowledge-usage-panel.js';
import { MetricKpiGrid } from './metric-kpi-grid.js';
import { MetricsTable } from './metrics-table.js';
import type {
  AnalyticsFilterOptions,
  AnalyticsFilters as Filters,
  AnalyticsStatus,
  TaskActivityAnalyticsGroup,
  TaskActivityAnalyticsResponse,
} from './types.js';

export interface AnalyticsBoardProps {
  status: AnalyticsStatus;
  response?: TaskActivityAnalyticsResponse | null;
  /** Error message shown in the error state. */
  error?: string | null;
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
  filterOptions?: AnalyticsFilterOptions;
  onRetry?: () => void;
  /** Drilldown from a comparison-table row. */
  onSelectGroup?: (group: TaskActivityAnalyticsGroup) => void;
}

/**
 * Top-level analytics composition. A pure function of props: it reads
 * `response.overall` for the KPI grid, `response.groups` for the table, and
 * `response.statsComplete` for the catching-up banner, and centralises the
 * loading / error / empty / ready states so hosts don't reimplement them.
 */
export function AnalyticsBoard({
  status,
  response,
  error,
  filters,
  onFiltersChange,
  filterOptions,
  onRetry,
  onSelectGroup,
}: AnalyticsBoardProps) {
  const theme = useTheme();

  const filterBar = (
    <AnalyticsFilters
      filters={filters}
      onFiltersChange={onFiltersChange}
      filterOptions={filterOptions}
    />
  );

  function frame(body: React.ReactNode) {
    return (
      <Stack gap={4}>
        {filterBar}
        {body}
      </Stack>
    );
  }

  if (status === 'loading') {
    return frame(<SkeletonBoard />);
  }

  if (status === 'error') {
    return frame(
      <Card variant="outlined" padding="md">
        <Stack gap={3} align="flex-start">
          <div role="alert">
            <Text color="error">
              {error ?? 'Could not load analytics for this cohort.'}
            </Text>
          </div>
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </Stack>
      </Card>,
    );
  }

  if (status === 'empty' || !response) {
    return frame(
      <Card variant="outlined" padding="md">
        <Text color="muted">
          No task activity matches these filters. Widen the date range or clear
          cohort filters.
        </Text>
      </Card>,
    );
  }

  const { overall, groups, statsComplete } = response;
  const isDailyTrend = filters.groupBy === 'day' && groups.length > 0;

  const trendPoints: SparklinePoint[] = isDailyTrend
    ? [...groups]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((g) => ({
          label: g.label,
          value: g.metrics.success.acceptedOutputRate,
        }))
    : [];

  return frame(
    <Stack gap={5}>
      {!statsComplete ? (
        <div role="status">
          <Card
            variant="outlined"
            padding="sm"
            style={{
              borderColor: theme.color.warning.DEFAULT,
              background: theme.color.warning.muted,
            }}
          >
            <Text
              variant="caption"
              style={{ color: theme.color.warning.DEFAULT }}
            >
              Stats are still catching up — some recent attempts may not be
              counted yet. Numbers may undercount.
            </Text>
          </Card>
        </div>
      ) : null}

      <MetricKpiGrid metrics={overall} />

      {isDailyTrend ? (
        <Card variant="outlined" padding="md">
          <Stack gap={2}>
            <Text
              variant="overline"
              style={{ color: theme.color.primary.DEFAULT }}
            >
              Accepted-output rate over time
            </Text>
            <Sparkline
              title="Accepted-output rate over time"
              points={trendPoints}
              width={520}
              height={64}
            />
          </Stack>
        </Card>
      ) : null}

      <Stack direction="row" gap={4} wrap>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <HurdlesPanel
            hurdles={overall.hurdles}
            toolCallCount={overall.raw.toolCallCount}
          />
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <KnowledgeUsagePanel knowledge={overall.knowledge} />
        </div>
      </Stack>

      <MetricsTable groups={groups} onSelectGroup={onSelectGroup} />
    </Stack>,
  );
}

/** Token-based skeleton placeholder for the loading state. */
function SkeletonBoard() {
  const theme = useTheme();
  const block = (height: number, width: string | number = '100%') => (
    <div
      style={{
        height,
        width,
        borderRadius: theme.radius.md,
        background: theme.color.bg.overlay,
        opacity: 0.6,
      }}
    />
  );

  return (
    <Stack gap={4} aria-hidden data-testid="analytics-skeleton">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: theme.spacing[3],
        }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>{block(88)}</div>
        ))}
      </div>
      {block(120)}
      {block(200)}
    </Stack>
  );
}
