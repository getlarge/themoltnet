import {
  Button,
  Container,
  MoltThemeProvider,
  Stack,
  Text,
  useThemeMode,
} from '@themoltnet/design-system';
import { useMemo, useState } from 'react';

import {
  AnalyticsBoard,
  type AnalyticsFiltersValue,
  type AnalyticsStatus,
  makeMetrics,
  makeResponse,
  type TaskActivityAnalyticsResponse,
} from '../src/index';

// Host-supplied filter options (in a real app these come from the API/session).
const FILTER_OPTIONS = {
  tags: [
    { value: 'ui', label: 'ui' },
    { value: 'backend', label: 'backend' },
    { value: 'docs', label: 'docs' },
  ],
  taskTypes: [
    { value: 'fulfill_brief', label: 'Fulfill Brief' },
    { value: 'assess_brief', label: 'Assess Brief' },
  ],
  profiles: [
    { value: 'p1', label: 'profile-fast' },
    { value: 'p2', label: 'profile-thorough' },
  ],
};

const DAY_KEYS = ['2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28'];

function buildResponse(
  filters: AnalyticsFiltersValue,
  statsComplete: boolean,
): TaskActivityAnalyticsResponse {
  const groupBy = filters.groupBy ?? 'none';
  const groups =
    groupBy === 'day'
      ? DAY_KEYS.map((key, i) => ({
          key,
          label: key.slice(5),
          metrics: makeMetrics({
            success: {
              ...makeMetrics().success,
              acceptedOutputRate: 0.6 + i * 0.08,
            },
          }),
        }))
      : groupBy === 'none'
        ? []
        : ['cohort-a', 'cohort-b', 'cohort-c'].map((label, i) => ({
            key: label,
            label,
            metrics: makeMetrics({
              success: {
                ...makeMetrics().success,
                acceptedOutputRate: 0.5 + i * 0.15,
              },
            }),
          }));

  return makeResponse({ statsComplete, groups });
}

const STATES: Array<{ id: AnalyticsStatus; label: string }> = [
  { id: 'ready', label: 'Ready' },
  { id: 'loading', label: 'Loading' },
  { id: 'empty', label: 'Empty' },
  { id: 'error', label: 'Error' },
];

function DemoContent() {
  const { resolvedMode, setMode } = useThemeMode();
  const [status, setStatus] = useState<AnalyticsStatus>('ready');
  const [statsComplete, setStatsComplete] = useState(true);
  const [filters, setFilters] = useState<AnalyticsFiltersValue>({
    completedAfter: '2026-06-01T00:00:00.000Z',
    completedBefore: '2026-07-01T00:00:00.000Z',
    groupBy: 'none',
  });

  const response = useMemo(
    () => buildResponse(filters, statsComplete),
    [filters, statsComplete],
  );

  return (
    <Container>
      <Stack gap={5} style={{ padding: '2rem 0' }}>
        <Stack direction="row" justify="space-between" align="center" wrap>
          <Text variant="h2">Task Analytics UI</Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setMode(resolvedMode === 'dark' ? 'light' : 'dark')
            }
          >
            {resolvedMode === 'dark' ? 'Light' : 'Dark'} theme
          </Button>
        </Stack>

        <Stack direction="row" gap={2} wrap>
          {STATES.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={status === s.id ? 'primary' : 'secondary'}
              onClick={() => setStatus(s.id)}
            >
              {s.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={statsComplete ? 'secondary' : 'accent'}
            onClick={() => setStatsComplete((v) => !v)}
          >
            {statsComplete ? 'Mark stats incomplete' : 'Stats incomplete ✓'}
          </Button>
        </Stack>

        <AnalyticsBoard
          status={status}
          response={status === 'ready' ? response : undefined}
          error={status === 'error' ? 'Simulated failure for the demo.' : null}
          filters={filters}
          onFiltersChange={setFilters}
          filterOptions={FILTER_OPTIONS}
          onRetry={() => setStatus('ready')}
        />
      </Stack>
    </Container>
  );
}

export function App() {
  return (
    <MoltThemeProvider mode="dark">
      <DemoContent />
    </MoltThemeProvider>
  );
}
