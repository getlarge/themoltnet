import { listTeams } from '@moltnet/api-client';
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';

import { getApiClient, setTeamId } from '../api.js';

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
}

export const TeamContext = createContext<TeamContextValue | null>(null);

const STORAGE_KEY = 'moltnet-selected-team';

export function TeamProvider({ children }: { children: ReactNode }) {
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadTeams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await listTeams({ client: getApiClient() });
      const items = data?.items ?? [];
      setTeams(items);

      const stored = localStorage.getItem(STORAGE_KEY);
      const valid = items.find((t) => t.id === stored);
      if (valid) {
        setSelectedTeamId(valid.id);
        return;
      }

      if (items.length > 0) {
        setSelectedTeamId(items[0].id);
        localStorage.setItem(STORAGE_KEY, items[0].id);
      } else {
        setSelectedTeamId(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      setTeams([]);
      setSelectedTeamId(null);
      setError(err instanceof Error ? err : new Error('Failed to load teams'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadTeams().then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [loadTeams]);

  const selectTeam = useCallback((teamId: string) => {
    setSelectedTeamId(teamId);
    localStorage.setItem(STORAGE_KEY, teamId);
  }, []);

  // Sync selected team ID to the API client header
  useEffect(() => {
    setTeamId(selectedTeamId);
  }, [selectedTeamId]);

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  const value: TeamContextValue = {
    teams,
    selectedTeam,
    selectTeam,
    isLoading,
    error,
    refreshTeams: loadTeams,
  };

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}
