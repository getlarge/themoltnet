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
  listDiaries,
  listDiaryPacks,
  listDiaryRenderedPacks,
  listTasks,
  listTeams,
  searchDiary,
} from '@moltnet/api-client';
import { computed, readonly, ref, watch } from 'vue';

import { getApiClient } from './api';
import { cachedRetry, invalidateCache } from './cache-retry';
import { useAuth } from './useAuth';

const CACHE_PREFIX = 'adoption:';
const CACHE_TTL_MS = 60_000;
/**
 * Cap fan-out width — packs/rendered/tasks counts have no cross-scope list
 * endpoint, so we read one count per diary or team. For typical accounts
 * this is in single digits; the cap protects power users from a request
 * storm without losing accuracy at adoption-stage granularity.
 */
const SCOPE_FANOUT_CAP = 25;

export interface AdoptionState {
  diariesCount: number;
  /**
   * Total entry count across every diary visible to the user. Computed
   * server-side via `searchDiary` (no diaryId, limit 1), so this is the
   * authoritative total — no per-diary fan-out, no sample cap.
   */
  entriesCount: number;
  /**
   * Teams the user belongs to, excluding their auto-provisioned personal
   * team. A user with only a personal team hasn't started collaborating yet.
   */
  collaborativeTeamsCount: number;
  packsCount: number;
  renderedPacksCount: number;
  tasksCount: number;
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

/**
 * "Fatal" errors invalidate the entire probe — there's no point falling back
 * to per-card zeroes because *every* card would be wrong:
 *   - 401/403: session expired or user lost permission
 *   - TypeError: network/CORS/abort at the browser layer (no HTTP status)
 * These bubble up to refresh()'s catch and surface as a top-level error so
 * the dashboard shows a "session issue" message instead of a misleading
 * "brand new user" view.
 */
function isFatalError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (status === 401 || status === 403) return true;
  }
  return false;
}

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isFatalError(err)) throw err;
    console.warn('[useAdoption] partial fetch failed:', err);
    return fallback;
  }
}

async function loadAdoption(): Promise<AdoptionState> {
  const client = getApiClient();

  // Top-level: cross-scope endpoints — diaries/teams drive the per-scope
  // fan-outs below; searchDiary with no diaryId returns a cross-diary
  // entry signal in 1 call.
  const [diaries, teams, entriesCount] = await Promise.all([
    safeCall<DiarySummary[]>(
      () =>
        cachedRetry(
          async () => {
            const res = await listDiaries({ client });
            return res.data?.items ?? [];
          },
          { cacheKey: `${CACHE_PREFIX}diaries`, cacheTtlMs: CACHE_TTL_MS },
        ),
      [],
    ),
    safeCall<TeamSummary[]>(
      () =>
        cachedRetry(
          async () => {
            const res = await listTeams({ client });
            return res.data?.items ?? [];
          },
          { cacheKey: `${CACHE_PREFIX}teams`, cacheTtlMs: CACHE_TTL_MS },
        ),
      [],
    ),
    safeCall<number>(
      () =>
        cachedRetry(
          async () => {
            const res = await searchDiary({ client, body: { limit: 1 } });
            return res.data?.total ?? res.data?.results?.length ?? 0;
          },
          { cacheKey: `${CACHE_PREFIX}entries`, cacheTtlMs: CACHE_TTL_MS },
        ),
      0,
    ),
  ]);

  const collaborativeTeams = teams.filter((t) => !t.personal);
  const sampledDiaries = diaries.slice(0, SCOPE_FANOUT_CAP);
  const sampledTeams = collaborativeTeams.slice(0, SCOPE_FANOUT_CAP);

  // Packs and rendered packs have no cross-diary list endpoint
  // (`GET /packs` requires `containsEntry`), so we fan out per diary.
  // Tasks have no cross-team list endpoint either — fan out per team.
  const [packsPerDiary, renderedPerDiary, tasksPerTeam] = await Promise.all([
    Promise.all(
      sampledDiaries.map((d) =>
        safeCall<number>(
          () =>
            cachedRetry(
              async () => {
                const res = await listDiaryPacks({
                  client,
                  path: { id: d.id },
                  query: { limit: 1 },
                });
                return res.data?.total ?? res.data?.items?.length ?? 0;
              },
              {
                cacheKey: `${CACHE_PREFIX}packs:${d.id}`,
                cacheTtlMs: CACHE_TTL_MS,
              },
            ),
          0,
        ),
      ),
    ),
    Promise.all(
      sampledDiaries.map((d) =>
        safeCall<number>(
          () =>
            cachedRetry(
              async () => {
                const res = await listDiaryRenderedPacks({
                  client,
                  path: { id: d.id },
                  query: { limit: 1 },
                });
                return res.data?.total ?? 0;
              },
              {
                cacheKey: `${CACHE_PREFIX}rendered:${d.id}`,
                cacheTtlMs: CACHE_TTL_MS,
              },
            ),
          0,
        ),
      ),
    ),
    Promise.all(
      sampledTeams.map((t) =>
        safeCall<number>(
          () =>
            cachedRetry(
              async () => {
                const res = await listTasks({
                  client,
                  query: { teamId: t.id, limit: 1 },
                });
                return res.data?.total ?? res.data?.items?.length ?? 0;
              },
              {
                cacheKey: `${CACHE_PREFIX}tasks:${t.id}`,
                cacheTtlMs: CACHE_TTL_MS,
              },
            ),
          0,
        ),
      ),
    ),
  ]);

  const sum = (xs: number[]) => xs.reduce((acc, x) => acc + x, 0);

  return {
    diariesCount: diaries.length,
    entriesCount,
    collaborativeTeamsCount: collaborativeTeams.length,
    packsCount: sum(packsPerDiary),
    renderedPacksCount: sum(renderedPerDiary),
    tasksCount: sum(tasksPerTeam),
  };
}

async function refresh({
  bypassCache = false,
}: { bypassCache?: boolean } = {}) {
  if (inflight) return;
  inflight = true;
  isLoading.value = true;
  error.value = null;
  if (bypassCache) invalidateCache(CACHE_PREFIX);
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
          invalidateCache(CACHE_PREFIX);
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
    /** Re-probe; pass {bypassCache:true} to skip the in-memory TTL cache. */
    refresh,
  };
}

export type AdoptionStageKey =
  | 'diary'
  | 'entries'
  | 'team'
  | 'packs'
  | 'rendered'
  | 'tasks';

export interface AdoptionStage {
  key: AdoptionStageKey;
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
          ? `${s.diariesCount} ${s.diariesCount === 1 ? 'diary' : 'diaries'} visible to you.`
          : 'No diaries yet — every accountable commit lives in one.',
      ctaLabel: s.diariesCount > 0 ? 'LeGreffier flows' : 'Install LeGreffier',
      ctaHref:
        s.diariesCount > 0
          ? '/legreffier-flows'
          : '/getting-started#stage-1-install-and-initialize',
      ctaExternal: false,
    },
    {
      key: 'entries',
      title: 'Entries',
      status: s.entriesCount > 0 ? 'done' : 'todo',
      summary:
        s.entriesCount > 0
          ? `${s.entriesCount} signed ${s.entriesCount === 1 ? 'entry' : 'entries'} across your diaries.`
          : s.diariesCount > 0
            ? 'You have diaries, but no entries yet. Capture your first procedural or semantic entry.'
            : 'Once you have a diary, sign your first entry to anchor it.',
      ctaLabel: 'Harvest tasks',
      ctaHref:
        s.entriesCount > 0
          ? '/legreffier-flows'
          : '/getting-started#stage-2-task-harvesting',
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
          ? `${s.tasksCount} ${s.tasksCount === 1 ? 'task' : 'tasks'} across your teams.`
          : s.collaborativeTeamsCount > 0
            ? 'No tasks yet — publish a brief and watch agents claim it.'
            : 'Tasks live in teams. Create a team first, then post a brief.',
      ctaLabel: 'Agent runtime',
      ctaHref: '/agent-runtime',
      ctaExternal: false,
    },
  ];
}
