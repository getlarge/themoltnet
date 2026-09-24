import {
  type Query,
  type QueryClient,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';

import { catalogueQuery, runCenterKeys } from './queries.js';
import type { AgentServerCatalogue } from './types.js';

export const CATALOGUE_ERROR =
  'Teams and profiles could not be loaded. Retry to verify access.';

export interface CatalogueState {
  catalogue: AgentServerCatalogue | null;
  /** First load only. A background refresh keeps the last good catalogue. */
  loading: boolean;
  /** Only when there is nothing to show; a failed refresh keeps the last catalogue. */
  error: string | null;
  /** The last refresh failed and `catalogue` is the previous good one. */
  stale: boolean;
  retry: () => void;
}

export const CATALOGUE_POLL_MS = 60_000;
export const CATALOGUE_RECOVERY_POLL_MS = 5_000;

/**
 * When each identity's catalogue started looking degraded, per client. A team
 * whose credential could not be verified is usually transient — a renewal the
 * API has not settled, a throttled read — so the poll owner checks again soon
 * and backs off towards the normal interval the longer it lasts.
 */
const degradedSince = new WeakMap<QueryClient, Map<string, number>>();

function degradedMarks(client: QueryClient): Map<string, number> {
  let marks = degradedSince.get(client);
  if (!marks) {
    marks = new Map();
    degradedSince.set(client, marks);
  }
  return marks;
}

function isDegraded(
  query: Query<
    AgentServerCatalogue,
    Error,
    AgentServerCatalogue,
    readonly unknown[]
  >,
): boolean {
  if (query.state.status === 'error') return true;
  return (
    query.state.data?.teams.some(
      (team) =>
        !team.available &&
        team.blockers.some(
          (blocker) => blocker.code === 'agent_key_unavailable',
        ),
    ) ?? false
  );
}

/** Half the time spent degraded so far, between the recovery and normal intervals. */
export function nextCatalogueRefresh(degradedForMs: number | null): number {
  if (degradedForMs === null) return CATALOGUE_POLL_MS;
  return Math.min(
    CATALOGUE_POLL_MS,
    Math.max(CATALOGUE_RECOVERY_POLL_MS, degradedForMs / 2),
  );
}

/**
 * The catalogue for one identity, from the shared cache.
 *
 * Every view calls this with the identity it is showing, so views on the same
 * identity read one cache entry instead of each running their own request with
 * its own loading flag and its own error string. `poll` marks the single owner
 * that refreshes it; the rest follow that owner's data.
 *
 * `active` is not `enabled`: views stay mounted when hidden, and disabling the
 * query would drop the cached value the hidden view still renders. It only
 * stops the timer.
 */
export function useCatalogue(
  identity: string,
  {
    active = true,
    poll = false,
    read,
  }: {
    active?: boolean;
    poll?: boolean;
    /** The catalogue reader, when the caller has one injected. */
    read?: (identity: string) => Promise<AgentServerCatalogue>;
  } = {},
): CatalogueState {
  const client = useQueryClient();
  const query = useQuery({
    ...catalogueQuery(identity, read),
    refetchInterval:
      poll && active
        ? (current) => {
            const marks = degradedMarks(client);
            if (!isDegraded(current)) {
              marks.delete(identity);
              return nextCatalogueRefresh(null);
            }
            const now = Date.now();
            const since = marks.get(identity) ?? now;
            marks.set(identity, since);
            return nextCatalogueRefresh(now - since);
          }
        : false,
  });
  const retry = useCallback(() => {
    // An explicit refresh (Retry, a renewal) restarts the quick checks.
    degradedMarks(client).delete(identity);
    void client.invalidateQueries({
      queryKey: runCenterKeys.catalogue(identity),
    });
  }, [client, identity]);
  const hasData = query.data !== undefined;
  return {
    catalogue: query.data ?? null,
    // `isPending` covers "no data yet"; a refetch must not flip the view back
    // into a loading state once something has been shown.
    loading: Boolean(identity) && query.isPending,
    error: query.isError && !hasData ? CATALOGUE_ERROR : null,
    stale: query.isError && hasData,
    retry,
  };
}
