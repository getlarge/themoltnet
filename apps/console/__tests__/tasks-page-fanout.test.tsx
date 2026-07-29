import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TasksPage } from '../src/pages/TasksPage.js';

/**
 * Regression tests for issue #1320: the Tasks page used to fan out one request
 * per board lane (plus a hidden table query and an always-on candidate query)
 * on every keystroke. These tests assert the fix: filters are debounced before
 * they feed query keys, the table query idles during board mode, and the
 * create-dialog candidate query only fires while the dialog is open.
 *
 * Strategy: mock the API-client query-options factories so each produces a real
 * TanStack queryKey derived from its `query` input and a queryFn that records
 * the request. A real QueryClient then drives actual fetches, so we can count
 * how many distinct /tasks requests a typing burst produces.
 */

interface ListTasksArgs {
  query?: {
    teamId?: string;
    query?: string;
    statuses?: string[];
    status?: string;
    taskTypes?: string[];
    correlationId?: string;
    limit?: number;
  };
}

const listTasksRequests: Array<ListTasksArgs['query']> = [];
const listTasksInfiniteRequests: Array<ListTasksArgs['query']> = [];
const listTasksInfiniteTotals = new Map<string, number>();

function recordingOptions(
  sink: Array<ListTasksArgs['query']>,
  id: string,
  args: ListTasksArgs,
  totals = new Map<string, number>(),
) {
  const q = args.query ?? {};
  return {
    queryKey: [id, q],
    queryFn: async () => {
      sink.push(q);
      const total = totals.get(q.statuses?.join(',') ?? '') ?? 0;
      return { items: [], total, nextCursor: undefined };
    },
  };
}

vi.mock('@moltnet/api-client/query', () => ({
  listTasksInfiniteOptions: (args: ListTasksArgs) =>
    recordingOptions(
      listTasksInfiniteRequests,
      'listTasksInfinite',
      args,
      listTasksInfiniteTotals,
    ),
  listTasksOptions: (args: ListTasksArgs) =>
    recordingOptions(listTasksRequests, 'listTasks', args),
  listTaskSchemasOptions: () => ({
    queryKey: ['listTaskSchemas'],
    queryFn: async () => ({ items: [] }),
  }),
  listRuntimeProfilesOptions: () => ({
    queryKey: ['listRuntimeProfiles'],
    queryFn: async () => ({ items: [] }),
  }),
  getTaskOptions: () => ({
    queryKey: ['getTask'],
    queryFn: async () => null,
  }),
  listTaskAttemptsOptions: () => ({
    queryKey: ['listTaskAttempts'],
    queryFn: async () => [],
  }),
  listTaskMessagesOptions: () => ({
    queryKey: ['listTaskMessages'],
    queryFn: async () => [],
  }),
}));

vi.mock('@moltnet/api-client', () => ({
  createTask: vi.fn(),
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ docsUrl: 'https://docs.example.com' }),
}));

vi.mock('../src/diaries/hooks.js', () => ({
  useDiarySummaries: () => ({ data: [{ id: 'd1', name: 'diary-1' }] }),
}));

vi.mock('../src/hooks/useIsMobile.js', () => ({
  useIsMobile: () => false,
}));

vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    error: null,
    refreshTeams: vi.fn(),
    selectedTeam: { id: 'team-1', name: 'team-1' },
  }),
}));

let currentSearch = '';
const navigate = vi.fn((target: string) => {
  currentSearch = new URL(target, 'https://console.example.com').search.slice(
    1,
  );
});
vi.mock('wouter', () => ({
  useLocation: () => ['/tasks', navigate],
  useSearch: () => currentSearch,
}));

// Keep task-ui out of the picture: we only care about query fanout, not the
// board/table rendering. Render minimal stand-ins that surface the search input
// from the real page (the page owns the input, not task-ui).
vi.mock('@moltnet/task-ui', () => {
  const taskLanes = [
    { id: 'pending', statuses: ['waiting', 'queued'] },
    { id: 'active', statuses: ['dispatched', 'running'] },
    { id: 'done', statuses: ['completed'] },
    { id: 'failed', statuses: ['failed'] },
    { id: 'closed', statuses: ['cancelled', 'expired'] },
  ];
  return {
    CreateTaskDialog: ({ open }: { open: boolean }) =>
      open ? <div data-testid="create-dialog" /> : null,
    isTaskNonTerminal: () => false,
    statusToLane: (status: string) =>
      taskLanes.find((lane) => lane.statuses.includes(status))?.id,
    TaskFunnelStrip: ({ counts }: { counts: Record<string, number> }) => (
      <div data-testid="lane-counts">{JSON.stringify(counts)}</div>
    ),
    TaskLaneBoard: () => <div data-testid="lane-board" />,
    TaskLivePane: () => null,
    TaskQueueTable: () => <div data-testid="queue-table" />,
    TaskTypeFacet: ({
      selected,
      onChange,
    }: {
      selected: string[];
      onChange: (next: string[]) => void;
    }) => (
      <div>
        <span data-testid="selected-task-types">{selected.join(',')}</span>
        <button type="button" onClick={() => onChange(['freeform'])}>
          Select freeform
        </button>
        <button type="button" onClick={() => onChange([])}>
          Clear task types
        </button>
      </div>
    ),
    TASK_LANES: taskLanes,
  };
});

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return (
    <QueryClientProvider client={client}>
      <MoltThemeProvider mode="dark">{children}</MoltThemeProvider>
    </QueryClientProvider>
  );
}

describe('TasksPage query fanout (#1320)', () => {
  beforeEach(() => {
    currentSearch = '';
    listTasksRequests.length = 0;
    listTasksInfiniteRequests.length = 0;
    listTasksInfiniteTotals.clear();
    navigate.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush() {
    // Let pending microtasks (query settlement) run under fake timers.
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('keeps the table infinite query disabled in board mode', async () => {
    render(<TasksPage />, { wrapper: Wrapper });
    await flush();

    // Default view is board. The infinite (table) query must not run; only the
    // lane queries should. None of the infinite requests should carry a
    // single-`status` table shape — every recorded infinite request comes from
    // a lane (carries `statuses`).
    for (const req of listTasksInfiniteRequests) {
      expect(req?.statuses).toBeDefined();
    }
    // And there must be at least the lane queries firing.
    expect(listTasksInfiniteRequests.length).toBeGreaterThan(0);
  });

  it('does not fetch create-dialog candidates before the dialog opens', async () => {
    render(<TasksPage />, { wrapper: Wrapper });
    await flush();

    // The candidate query is the only consumer of listTasksOptions on mount.
    // It is gated on showCreate, so nothing should have fired yet.
    expect(listTasksRequests.length).toBe(0);
  });

  it('applies a selected status to its board lane without fetching other lanes', async () => {
    listTasksInfiniteTotals.set('queued', 7);
    const { rerender } = render(<TasksPage />, { wrapper: Wrapper });
    await flush();
    listTasksInfiniteRequests.length = 0;

    fireEvent.click(screen.getByRole('button', { name: 'queued' }));

    expect(navigate).toHaveBeenLastCalledWith('/tasks?status=queued');

    rerender(<TasksPage />);
    await flush();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    await flush();

    expect(listTasksInfiniteRequests).toHaveLength(1);
    expect(listTasksInfiniteRequests[0]?.statuses).toEqual(['queued']);
    expect(
      JSON.parse(screen.getByTestId('lane-counts').textContent ?? ''),
    ).toEqual({
      pending: 7,
      active: 0,
      done: 0,
      failed: 0,
      closed: 0,
    });

    listTasksInfiniteRequests.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();

    expect(listTasksInfiniteRequests).toHaveLength(1);
    expect(listTasksInfiniteRequests[0]?.statuses).toEqual(['queued']);
  });

  it('derives task types from the URL and preserves the status filter', async () => {
    currentSearch = 'status=queued';
    const { rerender, unmount } = render(<TasksPage />, { wrapper: Wrapper });
    await flush();
    listTasksInfiniteRequests.length = 0;

    fireEvent.click(screen.getByRole('button', { name: 'Select freeform' }));

    expect(navigate).toHaveBeenLastCalledWith(
      '/tasks?status=queued&task_type=freeform',
    );

    rerender(<TasksPage />);
    await flush();

    expect(screen.getByTestId('selected-task-types').textContent).toBe(
      'freeform',
    );
    expect(listTasksInfiniteRequests).toHaveLength(1);
    expect(listTasksInfiniteRequests[0]?.statuses).toEqual(['queued']);
    expect(listTasksInfiniteRequests[0]?.taskTypes).toEqual(['freeform']);

    unmount();
    const remounted = render(<TasksPage />, { wrapper: Wrapper });
    await flush();

    expect(screen.getByTestId('selected-task-types').textContent).toBe(
      'freeform',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear task types' }));
    expect(navigate).toHaveBeenLastCalledWith('/tasks?status=queued');

    remounted.rerender(<TasksPage />);
    expect(screen.getByTestId('selected-task-types').textContent).toBe('');
  });

  it('tracks external URL filters while preserving mounted text input state', async () => {
    currentSearch =
      'status=queued&task_type=freeform&query=initial&correlation_id=corr-1';
    const { rerender } = render(<TasksPage />, { wrapper: Wrapper });
    await flush();

    expect(screen.getByTestId('selected-task-types').textContent).toBe(
      'freeform',
    );
    expect(screen.getByLabelText('Search tasks')).toHaveValue('initial');
    expect(screen.getByLabelText('Correlation ID')).toHaveValue('corr-1');

    currentSearch =
      'status=queued&task_type=structured&query=external&correlation_id=corr-2';
    rerender(<TasksPage />);
    await flush();

    expect(screen.getByTestId('selected-task-types').textContent).toBe(
      'structured',
    );
    expect(screen.getByLabelText('Search tasks')).toHaveValue('initial');
    expect(screen.getByLabelText('Correlation ID')).toHaveValue('corr-1');
  });

  it('debounces typing into one settled lane fanout instead of one per keystroke', async () => {
    render(<TasksPage />, { wrapper: Wrapper });
    await flush();

    const baseline = listTasksInfiniteRequests.length;
    listTasksInfiniteRequests.length = 0;

    const input = screen.getByLabelText('Search tasks');

    // Type four characters in quick succession (each within the 250ms window).
    for (const value of ['s', 'su', 'sub', 'subj']) {
      fireEvent.change(input, { target: { value } });
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }
    await flush();

    // Mid-burst: no new query should have fired for the intermediate values.
    expect(listTasksInfiniteRequests.length).toBe(0);

    // Let the debounce settle.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    await flush();

    // Exactly the lane set fires once for the final value — not once per
    // keystroke. baseline === lane count; the settled burst matches it.
    expect(listTasksInfiniteRequests.length).toBe(baseline);
    for (const req of listTasksInfiniteRequests) {
      expect(req?.query).toBe('subj');
    }
  });
});
