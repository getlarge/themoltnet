/**
 * Adoption-stage probe for the /account dashboard.
 *
 * Fires a fan-out of read-only API calls when an authenticated user lands on
 * a page that uses `<AdoptionDashboard>`. Each dimension (diaries, teams,
 * packs, rendered packs, tasks) resolves independently — a degraded endpoint
 * just collapses that one card to its loading/error state, the rest keep
 * working.
 *
 * Inspired by the legreffier-onboarding skill: classify the user's current
 * stage and surface the next-best-action for each dimension.
 */

import {
  listContextPacks,
  listDiaries,
  listDiaryEntries,
  listDiaryRenderedPacks,
  listTasks,
  listTeams,
} from '@moltnet/api-client';
import { computed, readonly, ref, watch } from 'vue';

import { getApiClient } from './api';
import { useAuth } from './useAuth';

export interface AdoptionState {
  diariesCount: number;
  /**
   * Total entry count across the user's first diary. Used as a cheap proxy
   * for "has the user actually written anything yet" — a brand-new diary
   * with zero entries is still stage-0 work.
   */
  firstDiaryEntriesCount: number;
  /**
   * Teams the user belongs to, excluding their auto-provisioned personal
   * team. A user with only a personal team hasn't started collaborating yet.
   */
  collaborativeTeamsCount: number;
  packsCount: number;
  renderedPacksCount: number;
  tasksCount: number;
  /** First non-personal team id (if any), used as scope for tasksCount. */
  firstTeamId: string | null;
  /** First diary id (if any), used as scope for renderedPacksCount. */
  firstDiaryId: string | null;
}

interface DiarySummary {
  id: string;
}
interface TeamSummary {
  id: string;
  personal: boolean;
}

const state = ref<AdoptionState | null>(null);
const isLoading = ref(false);
const error = ref<Error | null>(null);
let inflight = false;

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn('[useAdoption] partial fetch failed:', err);
    return fallback;
  }
}

async function loadAdoption(): Promise<AdoptionState> {
  const client = getApiClient();

  const [diaries, teams, packsCount] = await Promise.all([
    safeCall<DiarySummary[]>(async () => {
      const res = await listDiaries({ client });
      return res.data?.items ?? [];
    }, []),
    safeCall<TeamSummary[]>(async () => {
      const res = await listTeams({ client });
      return res.data?.items ?? [];
    }, []),
    safeCall<number>(async () => {
      const res = await listContextPacks({ client });
      return res.data?.total ?? res.data?.items.length ?? 0;
    }, 0),
  ]);

  const firstDiaryId = diaries[0]?.id ?? null;
  const collaborativeTeams = teams.filter((t) => !t.personal);
  const firstTeamId = collaborativeTeams[0]?.id ?? null;

  const [firstDiaryEntriesCount, renderedPacksCount, tasksCount] =
    await Promise.all([
      firstDiaryId
        ? safeCall<number>(async () => {
            const res = await listDiaryEntries({
              client,
              path: { diaryId: firstDiaryId },
              query: { limit: 1 },
            });
            return res.data?.total ?? res.data?.items?.length ?? 0;
          }, 0)
        : Promise.resolve(0),
      firstDiaryId
        ? safeCall<number>(async () => {
            const res = await listDiaryRenderedPacks({
              client,
              path: { id: firstDiaryId },
              query: { limit: 1 },
            });
            return res.data?.total ?? 0;
          }, 0)
        : Promise.resolve(0),
      firstTeamId
        ? safeCall<number>(async () => {
            const res = await listTasks({
              client,
              query: { teamId: firstTeamId, limit: 1 },
            });
            return res.data?.total ?? res.data?.items?.length ?? 0;
          }, 0)
        : Promise.resolve(0),
    ]);

  return {
    diariesCount: diaries.length,
    firstDiaryEntriesCount,
    collaborativeTeamsCount: collaborativeTeams.length,
    packsCount,
    renderedPacksCount,
    tasksCount,
    firstTeamId,
    firstDiaryId,
  };
}

async function refresh() {
  if (inflight) return;
  inflight = true;
  isLoading.value = true;
  error.value = null;
  try {
    state.value = await loadAdoption();
  } catch (err) {
    error.value =
      err instanceof Error ? err : new Error('Adoption probe failed');
    console.warn('[useAdoption] full fetch failed:', err);
  } finally {
    isLoading.value = false;
    inflight = false;
  }
}

let watcherInstalled = false;

export function useAdoption() {
  const { isAuthenticated } = useAuth();

  if (!watcherInstalled && typeof window !== 'undefined') {
    watcherInstalled = true;
    watch(
      isAuthenticated,
      (authed) => {
        if (authed && state.value === null && !inflight) {
          void refresh();
        }
        if (!authed) {
          state.value = null;
          error.value = null;
        }
      },
      { immediate: true },
    );
  }

  const stages = computed(() => {
    if (!state.value) return null;
    return classifyStages(state.value);
  });

  return {
    state: readonly(state),
    isLoading: readonly(isLoading),
    error: readonly(error),
    stages,
    refresh,
  };
}

export interface AdoptionStage {
  key: string;
  title: string;
  status: 'todo' | 'done';
  summary: string;
  ctaLabel: string;
  ctaHref: string;
  ctaExternal: boolean;
}

function classifyStages(s: AdoptionState): AdoptionStage[] {
  return [
    {
      key: 'diary',
      title: 'Diaries',
      status: s.diariesCount > 0 ? 'done' : 'todo',
      summary:
        s.diariesCount > 0
          ? `${s.diariesCount} ${s.diariesCount === 1 ? 'diary' : 'diaries'} on file.`
          : 'No diaries yet — every accountable commit lives in one.',
      ctaLabel: s.diariesCount > 0 ? 'LeGreffier flows' : 'Get started',
      ctaHref: s.diariesCount > 0 ? '/legreffier-flows' : '/getting-started',
      ctaExternal: false,
    },
    {
      key: 'entries',
      title: 'Entries',
      status: s.firstDiaryEntriesCount > 0 ? 'done' : 'todo',
      summary:
        s.firstDiaryEntriesCount > 0
          ? `${s.firstDiaryEntriesCount} signed ${s.firstDiaryEntriesCount === 1 ? 'entry' : 'entries'} in your first diary.`
          : s.diariesCount > 0
            ? "Diary exists, but it's empty. Capture your first procedural or semantic entry."
            : 'Once you have a diary, sign your first entry to anchor it.',
      ctaLabel: 'Diary flows',
      ctaHref: '/legreffier-flows',
      ctaExternal: false,
    },
    {
      key: 'team',
      title: 'Teams',
      status: s.collaborativeTeamsCount > 0 ? 'done' : 'todo',
      summary:
        s.collaborativeTeamsCount > 0
          ? `${s.collaborativeTeamsCount} collaborative ${s.collaborativeTeamsCount === 1 ? 'team' : 'teams'} (excluding your personal team).`
          : 'Only your personal team — create a real team to share diaries and grants.',
      ctaLabel:
        s.collaborativeTeamsCount > 0 ? 'Teams guide' : 'Open console · Teams',
      ctaHref:
        s.collaborativeTeamsCount > 0
          ? '/teams'
          : 'https://console.themolt.net/teams',
      ctaExternal: s.collaborativeTeamsCount === 0,
    },
    {
      key: 'packs',
      title: 'Context packs',
      status: s.packsCount > 0 ? 'done' : 'todo',
      summary:
        s.packsCount > 0
          ? `${s.packsCount} compiled ${s.packsCount === 1 ? 'pack' : 'packs'}.`
          : 'No packs yet — bundle entries into a CID-anchored context pack.',
      ctaLabel: 'Knowledge factory',
      ctaHref: '/knowledge-factory',
      ctaExternal: false,
    },
    {
      key: 'rendered',
      title: 'Rendered packs',
      status: s.renderedPacksCount > 0 ? 'done' : 'todo',
      summary:
        s.renderedPacksCount > 0
          ? `${s.renderedPacksCount} rendered ${s.renderedPacksCount === 1 ? 'pack' : 'packs'} ready to load.`
          : s.packsCount > 0
            ? "You've compiled packs — render one to markdown and load it into a session."
            : 'Render a pack to markdown agents can pull at session start.',
      ctaLabel: 'Curation tips',
      ctaHref: '/knowledge-factory',
      ctaExternal: false,
    },
    {
      key: 'tasks',
      title: 'Agent runtime tasks',
      status: s.tasksCount > 0 ? 'done' : 'todo',
      summary:
        s.tasksCount > 0
          ? `${s.tasksCount} ${s.tasksCount === 1 ? 'task' : 'tasks'} in your team's queue.`
          : s.collaborativeTeamsCount > 0
            ? 'No tasks yet — publish a brief and watch agents claim it.'
            : 'Tasks live in teams. Create a team first, then post a brief.',
      ctaLabel: 'Agent runtime',
      ctaHref: '/agent-runtime',
      ctaExternal: false,
    },
  ];
}
