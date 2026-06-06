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

function recordingOptions(
  sink: Array<ListTasksArgs['query']>,
  id: string,
  args: ListTasksArgs,
) {
  const q = args.query ?? {};
  return {
    queryKey: [id, q],
    queryFn: async () => {
      sink.push(q);
      return { items: [], total: 0, nextCursor: undefined };
    },
  };
}

vi.mock('@moltnet/api-client/query', () => ({
  listTasksInfiniteOptions: (args: ListTasksArgs) =>
    recordingOptions(listTasksInfiniteRequests, 'listTasksInfinite', args),
  listTasksOptions: (args: ListTasksArgs) =>
    recordingOptions(listTasksRequests, 'listTasks', args),
  listTaskSchemasOptions: () => ({
    queryKey: ['listTaskSchemas'],
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

const navigate = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/tasks', navigate],
  useSearch: () => '',
}));

// Keep task-ui out of the picture: we only care about query fanout, not the
// board/table rendering. Render minimal stand-ins that surface the search input
// from the real page (the page owns the input, not task-ui).
vi.mock('@moltnet/task-ui', () => ({
  CreateTaskDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-dialog" /> : null,
  isTaskNonTerminal: () => false,
  TaskFunnelStrip: () => null,
  TaskLaneBoard: () => <div data-testid="lane-board" />,
  TaskLivePane: () => null,
  TaskQueueTable: () => <div data-testid="queue-table" />,
  TaskTypeFacet: () => null,
  TASK_LANES: [
    { id: 'pending', statuses: ['waiting', 'queued'] },
    { id: 'active', statuses: ['dispatched', 'running'] },
    { id: 'done', statuses: ['completed'] },
    { id: 'failed', statuses: ['failed'] },
    { id: 'closed', statuses: ['cancelled', 'expired'] },
  ],
}));

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
    listTasksRequests.length = 0;
    listTasksInfiniteRequests.length = 0;
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
