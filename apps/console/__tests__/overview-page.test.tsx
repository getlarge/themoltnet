import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('leads with live task counts and keeps the cost-cap caveat visible', async () => {
    render(<OverviewPage />, { wrapper: Wrapper });

    // Task-state tiles lead the page (queued = 1 from the mock), no longer
    // buried in a disclosure.
    expect(
      await screen.findByRole('button', { name: /1 Queued/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    // The current task phase still reads in the setup checklist.
    expect(screen.getByText('Task waiting for an agent')).toBeInTheDocument();
    expect(
      screen.getByText(/authorized agent-daemon running to claim work/i),
    ).toBeInTheDocument();
    // Cost caveat is present and no longer inside a <details>.
    expect(
      screen.getByText(/Cost is not estimated or capped here/),
    ).toBeInTheDocument();
    // The old numbered-eyebrow triptych + disclosure are gone.
    expect(
      screen.queryByText('Pilot checks and activity'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('2. Team agent')).not.toBeInTheDocument();
  });

  it('keeps workspace and agent phases when the task query fails', async () => {
    mocks.listTasks.mockRejectedValue(new Error('tasks unavailable'));

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText('Task status unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByText('Project workspace ready')).toBeInTheDocument();
    expect(screen.getByText('Team agent ready')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Pilot status is unavailable' }),
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
