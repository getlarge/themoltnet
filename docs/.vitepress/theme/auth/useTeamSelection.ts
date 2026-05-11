import { listTeams } from '@moltnet/api-client';
import { computed, readonly, ref, watch } from 'vue';

import { getApiClient } from './api';
import { useAuth } from './useAuth';

const STORAGE_KEY = 'moltnet-docs:selected-team-id';

export interface DocsTeam {
  id: string;
  name: string;
  personal: boolean;
  status: string;
  role: string;
}

const teams = ref<DocsTeam[]>([]);
const selectedTeamId = ref<string | null>(null);
const isLoading = ref(false);
const error = ref<Error | null>(null);
let inflight: Promise<void> | null = null;

function readStoredTeamId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

function writeStoredTeamId(teamId: string | null): void {
  if (typeof window === 'undefined') return;
  if (teamId) {
    window.localStorage.setItem(STORAGE_KEY, teamId);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function chooseDefaultTeam(items: DocsTeam[]): string | null {
  const stored = readStoredTeamId();
  if (stored && items.some((team) => team.id === stored)) {
    return stored;
  }

  return items.find((team) => team.personal)?.id ?? items[0]?.id ?? null;
}

async function loadTeams(): Promise<void> {
  if (inflight) return inflight;

  inflight = (async () => {
    isLoading.value = true;
    try {
      const res = await listTeams({ client: getApiClient() });
      const items = res.data?.items ?? [];
      teams.value = items;

      if (
        !selectedTeamId.value ||
        !items.some((team) => team.id === selectedTeamId.value)
      ) {
        selectedTeamId.value = chooseDefaultTeam(items);
        writeStoredTeamId(selectedTeamId.value);
      }

      error.value = null;
    } catch (err) {
      error.value =
        err instanceof Error ? err : new Error('Could not load teams');
    } finally {
      isLoading.value = false;
      inflight = null;
    }
  })();

  return inflight;
}

export function useTeamSelection() {
  const { isAuthenticated } = useAuth();

  watch(
    isAuthenticated,
    (authenticated) => {
      if (authenticated) {
        void loadTeams();
      } else {
        teams.value = [];
        selectedTeamId.value = null;
        writeStoredTeamId(null);
      }
    },
    { immediate: true },
  );

  const selectedTeam = computed(
    () => teams.value.find((team) => team.id === selectedTeamId.value) ?? null,
  );

  function setSelectedTeam(teamId: string): void {
    if (!teams.value.some((team) => team.id === teamId)) return;
    selectedTeamId.value = teamId;
    writeStoredTeamId(teamId);
  }

  return {
    teams: readonly(teams),
    selectedTeam,
    selectedTeamId: readonly(selectedTeamId),
    isLoading: readonly(isLoading),
    error: readonly(error),
    refreshTeams: loadTeams,
    setSelectedTeam,
  };
}
