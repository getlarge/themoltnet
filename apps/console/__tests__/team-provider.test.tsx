import { act, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TeamProvider } from '../src/team/TeamProvider.js';
import { useTeam } from '../src/team/useTeam.js';

const mockListTeams = vi.fn();
const mockSetTeamId = vi.fn();

vi.mock('@moltnet/api-client', () => ({
  listTeams: (...args: unknown[]) => mockListTeams(...args),
  createClient: () => ({}),
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
  setTeamId: (...args: unknown[]) => mockSetTeamId(...args),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    kratosUrl: 'https://auth.example.com',
    consoleUrl: 'https://console.example.com',
    apiBaseUrl: 'https://api.example.com',
  }),
}));

function TeamDisplay() {
  const { selectedTeam, teams, isLoading } = useTeam();
  if (isLoading) return <div data-testid="loading">Loading</div>;
  return (
    <div>
      <span data-testid="team-name">{selectedTeam?.name ?? 'none'}</span>
      <span data-testid="team-count">{teams.length}</span>
    </div>
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MoltThemeProvider mode="dark">
      <TeamProvider>{children}</TeamProvider>
    </MoltThemeProvider>
  );
}

const TWO_TEAMS = {
  data: {
    items: [
      {
        id: 'team-1',
        name: 'moltnet-core',
        personal: false,
        status: 'active',
        role: 'owner',
      },
      {
        id: 'team-2',
        name: 'personal',
        personal: true,
        status: 'active',
        role: 'owner',
      },
    ],
  },
};

describe('TeamProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('loads teams and selects the first one', async () => {
    mockListTeams.mockResolvedValue({
      data: {
        items: [
          {
            id: 'team-1',
            name: 'moltnet-core',
            personal: false,
            status: 'active',
            role: 'owner',
          },
          {
            id: 'team-2',
            name: 'personal',
            personal: true,
            status: 'active',
            role: 'owner',
          },
        ],
      },
    });

    render(<TeamDisplay />, { wrapper: Wrapper });
    expect(screen.getByTestId('loading')).toBeDefined();

    await waitFor(() => {
      expect(screen.getByTestId('team-name').textContent).toBe('moltnet-core');
    });
    expect(screen.getByTestId('team-count').textContent).toBe('2');
  });

  it('restores previously selected team from localStorage', async () => {
    localStorage.setItem('moltnet-selected-team', 'team-2');
    mockListTeams.mockResolvedValue({
      data: {
        items: [
          {
            id: 'team-1',
            name: 'moltnet-core',
            personal: false,
            status: 'active',
            role: 'owner',
          },
          {
            id: 'team-2',
            name: 'personal',
            personal: true,
            status: 'active',
            role: 'owner',
          },
        ],
      },
    });

    render(<TeamDisplay />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('team-name').textContent).toBe('personal');
    });
  });

  it('calls setTeamId synchronously when selectTeam is invoked', async () => {
    mockListTeams.mockResolvedValue(TWO_TEAMS);

    let selectFn: ((id: string) => void) | null = null;
    function Capture() {
      const { selectTeam, selectedTeam } = useTeam();
      selectFn = selectTeam;
      return <span data-testid="current">{selectedTeam?.id ?? 'none'}</span>;
    }

    render(<Capture />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('current').textContent).toBe('team-1');
    });

    mockSetTeamId.mockClear();
    act(() => {
      selectFn?.('team-2');
    });

    // Race-condition guard: setTeamId('team-2') must happen in the same tick
    // as selectTeam, BEFORE any child effect observing selectedTeamId fires.
    expect(mockSetTeamId).toHaveBeenCalledWith('team-2');
    expect(localStorage.getItem('moltnet-selected-team')).toBe('team-2');
  });

  it('persists the selected team to localStorage on selectTeam', async () => {
    mockListTeams.mockResolvedValue(TWO_TEAMS);

    let selectFn: ((id: string) => void) | null = null;
    function Capture() {
      const { selectTeam } = useTeam();
      selectFn = selectTeam;
      return null;
    }

    render(<Capture />, { wrapper: Wrapper });
    await waitFor(() => expect(selectFn).not.toBeNull());

    act(() => {
      selectFn?.('team-2');
    });
    expect(localStorage.getItem('moltnet-selected-team')).toBe('team-2');
  });
});
