import { listTeamsOptions } from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { getApiClient, setTeamId } from '../api.js';
import { useAuth } from '../auth/useAuth.js';

export interface TeamItem {
  id: string;
  name: string;
  personal: boolean;
  status: string;
  role: string;
}

export interface TeamContextValue {
  teams: TeamItem[];
  selectedTeam: TeamItem | null;
  selectTeam: (teamId: string) => void;
  isLoading: boolean;
  error: Error | null;
  refreshTeams: () => Promise<void>;
  callerRoleForTeam: (teamId: string) => string | null;
}

export const TeamContext = createContext<TeamContextValue | null>(null);

const STORAGE_KEY = 'moltnet-selected-team';

export function TeamProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const teamsQueryEnabled = !isAuthLoading && isAuthenticated;

  const {
    data: teamsResponse,
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...listTeamsOptions({
      client: getApiClient(),
    }),
    enabled: teamsQueryEnabled,
  });
  const teams = useMemo(() => teamsResponse?.items ?? [], [teamsResponse]);

  useEffect(() => {
    if (!teamsQueryEnabled || isLoading) return;

    const stored = localStorage.getItem(STORAGE_KEY);
    const valid = teams.find((t) => t.id === stored);
    if (valid) {
      setSelectedTeamId((current) =>
        current === valid.id ? current : valid.id,
      );
      return;
    }

    if (teams.length > 0) {
      setSelectedTeamId((current) => {
        if (current === teams[0].id) return current;
        localStorage.setItem(STORAGE_KEY, teams[0].id);
        return teams[0].id;
      });
      return;
    }

    setSelectedTeamId(null);
    localStorage.removeItem(STORAGE_KEY);
  }, [isLoading, teams, teamsQueryEnabled]);

  const selectTeam = useCallback((teamId: string) => {
    // Set the API client header synchronously BEFORE triggering the
    // re-render. React runs child effects before parent effects, so deferring
    // this to a useEffect causes any child that fetches on selectedTeam.id
    // change to hit the API with the previous team header.
    setTeamId(teamId);
    setSelectedTeamId(teamId);
    localStorage.setItem(STORAGE_KEY, teamId);
  }, []);

  // Keep the API client header in sync with programmatic changes to
  // selectedTeamId that don't go through selectTeam (e.g. initial load
  // from localStorage, refreshTeams clearing the selection).
  useEffect(() => {
    setTeamId(selectedTeamId);
  }, [selectedTeamId]);

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  const callerRoleForTeam = useCallback(
    (teamId: string) => teams.find((t) => t.id === teamId)?.role ?? null,
    [teams],
  );

  const value: TeamContextValue = {
    teams,
    selectedTeam,
    selectTeam,
    isLoading: isAuthLoading || isLoading,
    error: error ? new Error('Failed to load teams', { cause: error }) : null,
    refreshTeams: async () => {
      await refetch();
    },
    callerRoleForTeam,
  };

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}
