import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { catalogueQuery, runCenterKeys } from './queries.js';
import type { AgentServerCatalogue } from './types.js';

export const CATALOGUE_ERROR =
  'Teams and profiles could not be loaded. Retry to verify access.';

export interface CatalogueState {
  catalogue: AgentServerCatalogue | null;
  /** First load only. A background refresh keeps the last good catalogue. */
  loading: boolean;
  error: string | null;
  retry: () => void;
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
    refetchInterval: poll && active ? 60_000 : false,
  });
  const retry = useCallback(() => {
    void client.invalidateQueries({
      queryKey: runCenterKeys.catalogue(identity),
    });
  }, [client, identity]);
  return {
    catalogue: query.data ?? null,
    // `isPending` covers "no data yet"; a refetch must not flip the view back
    // into a loading state once something has been shown.
    loading: Boolean(identity) && query.isPending,
    error: query.isError ? CATALOGUE_ERROR : null,
    retry,
  };
}
