import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OverviewPage } from '../src/pages/OverviewPage.js';

const getTeam = vi.fn();
const listTasks = vi.fn();
const navigate = vi.fn();

vi.mock('@moltnet/api-client/query', () => ({
  getTeamOptions: () => ({
    queryKey: ['getTeam'],
    queryFn: () => getTeam(),
  }),
  listTasksOptions: () => ({
    queryKey: ['listTasks'],
    queryFn: () => listTasks(),
  }),
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
}));

vi.mock('../src/auth/useAuth.js', () => ({
  useAuth: () => ({ username: 'Edouard' }),
}));

vi.mock('../src/diaries/hooks.js', () => ({
  useDiarySummaries: () => ({
    data: [{ id: 'diary-1', name: 'Project memory' }],
    error: null,
    isLoading: false,
  }),
}));

vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    error: null,
    isLoading: false,
    selectedTeam: {
      id: 'team-1',
      name: 'Team One',
      personal: false,
      role: 'owner',
      status: 'active',
    },
  }),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/', navigate],
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
    navigate.mockReset();
    getTeam.mockResolvedValue({
      members: [
        {
          displayName: 'Molt',
          role: 'manager',
          subjectId: 'agent-1',
          subjectType: 'agent',
        },
      ],
    });
    listTasks.mockResolvedValue({
      items: [{ id: 'task-1', status: 'queued' }],
      total: 1,
    });
  });

  it('surfaces the queued-task, daemon, and cost-cap constraints', async () => {
    render(<OverviewPage />, { wrapper: Wrapper });

    expect(
      await screen.findByRole('heading', {
        name: 'Task waiting for an agent',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/running agent-daemon to claim work/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Cost is not estimated or capped here'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Pilot checks and activity').closest('details'),
    ).toBeInTheDocument();
  });
});
