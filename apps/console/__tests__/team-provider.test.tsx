import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TeamProvider } from '../src/team/TeamProvider.js';
import { useTeam } from '../src/team/useTeam.js';
import { createTestWrapper } from './test-query-client.js';

const mockListTeams = vi.fn();
const mockSetTeamId = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('@moltnet/api-client/query', () => ({
  listTeamsOptions: (...args: unknown[]) => ({
    queryKey: ['teams'],
    queryFn: async () => {
      const response = await mockListTeams(...args);
      return response.data;
    },
  }),
  createClient: () => ({}),
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({}),
  setTeamId: (...args: unknown[]) => mockSetTeamId(...args),
}));

vi.mock('../src/auth/useAuth.js', () => ({
  useAuth: () => mockUseAuth(),
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
    mockUseAuth.mockReturnValue({
      session: null,
      identity: null,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      logout: vi.fn(),
      refreshSession: vi.fn(),
      username: null,
      email: null,
    });
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

    const wrapper = createTestWrapper();
    render(
      <TeamProvider>
        <TeamDisplay />
      </TeamProvider>,
      { wrapper },
    );
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

    const wrapper = createTestWrapper();
    render(
      <TeamProvider>
        <TeamDisplay />
      </TeamProvider>,
      { wrapper },
    );
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

    const wrapper = createTestWrapper();
    render(
      <TeamProvider>
        <Capture />
      </TeamProvider>,
      { wrapper },
    );
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

    const wrapper = createTestWrapper();
    render(
      <TeamProvider>
        <Capture />
      </TeamProvider>,
      { wrapper },
    );
    await waitFor(() => expect(selectFn).not.toBeNull());

    act(() => {
      selectFn?.('team-2');
    });
    expect(localStorage.getItem('moltnet-selected-team')).toBe('team-2');
  });

  it('does not clear a stored team selection while auth is still loading', () => {
    localStorage.setItem('moltnet-selected-team', 'team-2');
    mockUseAuth.mockReturnValue({
      session: null,
      identity: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
      logout: vi.fn(),
      refreshSession: vi.fn(),
      username: null,
      email: null,
    });

    const wrapper = createTestWrapper();
    render(
      <TeamProvider>
        <TeamDisplay />
      </TeamProvider>,
      { wrapper },
    );

    expect(localStorage.getItem('moltnet-selected-team')).toBe('team-2');
    expect(screen.getByTestId('loading')).toBeDefined();
    expect(mockListTeams).not.toHaveBeenCalled();
  });
});
