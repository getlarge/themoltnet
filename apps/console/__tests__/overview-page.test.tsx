import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OverviewPage } from '../src/pages/OverviewPage.js';

const mocks = vi.hoisted(() => ({
  getTeam: vi.fn(),
  listAgentKeys: vi.fn(),
  listRuntimeProfiles: vi.fn(),
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
  listAgentKeysOptions: () => ({
    queryKey: ['listAgentKeys'],
    queryFn: () => mocks.listAgentKeys(),
  }),
  listRuntimeProfilesOptions: () => ({
    queryKey: ['listRuntimeProfiles'],
    queryFn: () => mocks.listRuntimeProfiles(),
  }),
  listTasksOptions: () => ({
    queryKey: ['listTasks'],
    queryFn: () => mocks.listTasks(),
  }),
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
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
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.useDiarySummaries.mockReturnValue({
      data: [
        {
          entryCount: 12,
          id: 'diary-1',
          name: 'Project memory',
          tagCount: 4,
        },
      ],
      error: null,
      isError: false,
      isLoading: false,
    });
    mocks.useTeam.mockReturnValue({
      error: null,
      isLoading: false,
      selectedTeam: {
        id: 'team-1',
        name: 'Team One',
        personal: false,
      },
    });
    mocks.getTeam.mockResolvedValue({
      members: [{ subjectId: 'agent-1', subjectType: 'agent' }],
    });
    mocks.listAgentKeys.mockResolvedValue({
      items: [{ id: 'key-1', status: 'active' }],
      nextCursor: null,
    });
    mocks.listRuntimeProfiles.mockResolvedValue({
      items: [
        { id: 'profile-1', toolEnforcement: 'enforce' },
        { id: 'profile-2', toolEnforcement: 'watch' },
      ],
    });
    mocks.listTasks.mockResolvedValue({
      items: [
        { id: 'task-running', status: 'running', taskType: 'freeform' },
        {
          id: 'task-failed',
          status: 'failed',
          taskType: 'fulfill_brief',
          title: 'Repair release',
        },
      ],
      total: 2,
    });
  });

  it('presents the three operating systems and live attention work', async () => {
    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Operations' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Three systems. One operating model.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Coordinate durable work')).toBeVisible();
    expect(screen.getByText('Bound execution authority')).toBeVisible();
    expect(screen.getByText('Retain accountable context')).toBeVisible();
    expect(await screen.findByText('Repair release')).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: 'Agents should not inherit your authority',
      }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Repair release/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/tasks/task-failed');
  });

  it('keeps task query failure distinct from a zero-task state', async () => {
    mocks.listTasks.mockRejectedValue(new Error('tasks unavailable'));

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(/Counts are unavailable, not zero/i),
    ).toBeVisible();
    const taskPanel = screen
      .getByText('Coordinate durable work')
      .closest('article');
    expect(taskPanel).not.toBeNull();
    expect(within(taskPanel!).getByText('Unavailable')).toBeVisible();
  });

  it('does not present a pending task query as an empty success state', () => {
    mocks.listTasks.mockReturnValue(new Promise(() => {}));

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(screen.getByText('Loading task activity…')).toBeVisible();
    expect(
      screen.queryByText('No loaded tasks need attention'),
    ).not.toBeInTheDocument();
  });

  it('qualifies attention and lane metrics when only the first page is loaded', async () => {
    mocks.listTasks.mockResolvedValue({
      items: [{ id: 'task-waiting', status: 'waiting', taskType: 'freeform' }],
      total: 120,
    });

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(/drawn from the 1 most recently loaded of 120/i),
    ).toBeVisible();
    expect(screen.getByText('Active · loaded page')).toBeVisible();
    expect(screen.getByText('Waiting · loaded page')).toBeVisible();
  });

  it('surfaces runtime query failure without inventing authority counts', async () => {
    mocks.listAgentKeys.mockRejectedValue(new Error('keys unavailable'));

    render(<OverviewPage />, { wrapper: Wrapper });

    const runtimePanel = (
      await screen.findByText('Bound execution authority')
    ).closest('article');
    expect(runtimePanel).not.toBeNull();
    expect(await within(runtimePanel!).findByText('Unavailable')).toBeVisible();
    expect(within(runtimePanel!).getAllByText('—')).not.toHaveLength(0);
  });

  it('offers team recovery when team scope fails', () => {
    mocks.useTeam.mockReturnValue({
      error: new Error('team unavailable'),
      isLoading: false,
      selectedTeam: null,
    });

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Team scope unavailable',
    );
  });

  it('asks for a project team instead of querying personal workspace data', () => {
    mocks.useTeam.mockReturnValue({
      error: null,
      isLoading: false,
      selectedTeam: { id: 'personal', name: 'Personal', personal: true },
    });

    render(<OverviewPage />, { wrapper: Wrapper });

    expect(screen.getByText('Select a project team')).toBeVisible();
    expect(mocks.listTasks).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', {
        name: 'Three systems. One operating model.',
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });
});
