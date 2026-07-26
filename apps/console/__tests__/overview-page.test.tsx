import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OverviewPage } from '../src/pages/OverviewPage.js';

const mocks = vi.hoisted(() => ({
  getTeam: vi.fn(),
  listTasks: vi.fn(),
  navigate: vi.fn(),
  useDiarySummaries: vi.fn(),
  useTeam: vi.fn(),
}));

vi.mock('@moltnet/api-client/query', () => ({
  getTeamOptions: () => ({
    queryKey: ['getTeam'],
    queryFn: () => mocks.getTeam(),
  }),
  listTasksOptions: () => ({
    queryKey: ['listTasks'],
    queryFn: () => mocks.listTasks(),
  }),
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
}));

vi.mock('../src/auth/useAuth.js', () => ({
  useAuth: () => ({ username: 'Edouard' }),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    apiBaseUrl: 'https://api.example.test',
    consoleUrl: 'https://console.example.test',
    docsUrl: 'https://docs.example.test',
    kratosUrl: 'https://auth.example.test',
  }),
}));

vi.mock('../src/diaries/hooks.js', () => ({
  useDiarySummaries: (...args: unknown[]) => mocks.useDiarySummaries(...args),
}));

vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => mocks.useTeam(),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/', mocks.navigate],
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

describe('OverviewPage', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.useDiarySummaries.mockReturnValue({
      data: [{ id: 'diary-1', name: 'Project memory' }],
      error: null,
      isLoading: false,
    });
    mocks.useTeam.mockReturnValue({
      error: null,
      isLoading: false,
      selectedTeam: {
        id: 'team-1',
        name: 'Team One',
        personal: false,
        role: 'owner',
        status: 'active',
      },
    });
    mocks.getTeam.mockResolvedValue({
      members: [
        {
          displayName: 'Molt',
          role: 'manager',
          subjectId: 'agent-1',
          subjectType: 'agent',
        },
      ],
    });
    mocks.listTasks.mockResolvedValue({
      items: [{ id: 'task-1', status: 'queued' }],
      total: 1,
    });
  });

  it('shows the correct count on every lane tile and links to the board', async () => {
    // A mixed-status set with a distinct count per lane so each tile is
    // unambiguous: queued 2, active 3, waiting 1, completed 4, unsuccessful 5.
    mocks.listTasks.mockResolvedValue({
      items: [
        ...Array(2).fill({ status: 'queued' }),
        ...Array(3).fill({ status: 'running' }),
        ...Array(1).fill({ status: 'waiting' }),
        ...Array(4).fill({ status: 'completed' }),
        ...Array(5).fill({ status: 'failed' }),
      ],
      total: 15,
    });

    render(<OverviewPage />, { wrapper: Wrapper });

    const expected: Array<[string, string]> = [
      ['queued', '2'],
      ['active', '3'],
      ['waiting', '1'],
      ['completed', '4'],
      ['unsuccessful', '5'],
    ];
    for (const [lane, count] of expected) {
      const tile = await screen.findByTestId(`task-tile-${lane}`);
      expect(within(tile).getByText(count)).toBeInTheDocument();
      expect(
        within(tile).getByText(new RegExp(`^${lane}$`, 'i')),
      ).toBeInTheDocument();
    }

    // The single board control navigates (tiles themselves are data, not links).
    fireEvent.click(screen.getByRole('button', { name: 'Task board →' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/tasks');

    // Cost caveat is present and no longer inside a <details>.
    expect(
      screen.getByText(/Cost is not estimated or capped here/),
    ).toBeInTheDocument();
  });

  it('renders task activity as unavailable (not zero) when the task query fails', async () => {
    mocks.listTasks.mockRejectedValue(new Error('tasks unavailable'));

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(/counts are unavailable, not zero/i),
    ).toBeInTheDocument();
    // No zero-tiles are shown during the outage.
    expect(screen.queryByTestId('task-tile-queued')).not.toBeInTheDocument();
    // The setup checklist still reflects the workspace/agent phases.
    expect(screen.getByText('Project workspace ready')).toBeInTheDocument();
    expect(screen.getByText('Team agent ready')).toBeInTheDocument();
  });

  it('qualifies lane counts as loaded-page when the team has more tasks than the page', async () => {
    mocks.listTasks.mockResolvedValue({
      items: [{ status: 'queued' }, { status: 'queued' }],
      total: 120,
    });

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        /Counts reflect the 2 most recently loaded of 120 tasks/i,
      ),
    ).toBeInTheDocument();
  });

  it('collapses the setup checklist to a summary once every phase is complete', async () => {
    // Diary + agent present (from beforeEach) and a completed task ⇒ all three
    // phases complete.
    mocks.listTasks.mockResolvedValue({
      items: [{ status: 'completed' }],
      total: 1,
    });

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(/Pilot setup complete/i),
    ).toBeInTheDocument();
    // Individual phase rows are not shown once collapsed.
    expect(screen.queryByText('Ready a team agent')).not.toBeInTheDocument();
  });

  it('distinguishes unavailable membership from a confirmed absent agent', async () => {
    mocks.getTeam.mockRejectedValue(new Error('members unavailable'));

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        /Team membership couldn't be loaded, so agent presence is unknown/i,
      ),
    ).toBeInTheDocument();
    // It must not claim there is "no agent" when membership simply failed.
    expect(
      screen.queryByText(/No agent is a member of this team/i),
    ).not.toBeInTheDocument();
  });

  it('marks only the diary phase unavailable when diaries fail', async () => {
    mocks.useDiarySummaries.mockReturnValue({
      data: undefined,
      error: new Error('diaries unavailable'),
      isLoading: false,
    });

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText('Diary status unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByText('Team agent ready')).toBeInTheDocument();
    expect(screen.getByText('Task waiting for an agent')).toBeInTheDocument();
  });

  it('renders the loading state from an overridable team hook', () => {
    mocks.useTeam.mockReturnValue({
      error: null,
      isLoading: true,
      selectedTeam: null,
    });

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      screen.getByText('Loading the current pilot briefing…'),
    ).toBeInTheDocument();
  });

  it('renders and wires the team-level error recovery actions', () => {
    mocks.useTeam.mockReturnValue({
      error: new Error('team unavailable'),
      isLoading: false,
      selectedTeam: null,
    });

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      screen.getByRole('heading', { name: 'Pilot status is unavailable' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open teams' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open tasks' }));

    expect(mocks.navigate).toHaveBeenNthCalledWith(1, '/teams');
    expect(mocks.navigate).toHaveBeenNthCalledWith(2, '/tasks');
  });
});
