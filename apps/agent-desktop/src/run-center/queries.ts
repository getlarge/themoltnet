/**
 * Query definitions for run-center reads.
 *
 * Hand-written rather than generated: every read here crosses native IPC
 * (`invoke`), so the generated fetch-based helpers in
 * `@moltnet/agent-daemon-api-client` do not apply — the renderer has no base
 * URL and issues no HTTP.
 *
 * Polling belongs to exactly one owner per key. `refetchInterval` is
 * per-observer, so every mounted view declaring an interval runs its own timer.
 * Identical intervals are harmless — the resulting fetches are concurrent on one
 * key and dedupe into a single request — but staggered ones do not, so each
 * extra interval is an extra read. Views that only read pass
 * `refetchInterval: false` (the default here) and share the owner's data.
 */
import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { projectActions, runCenterActions } from './run-center-bridge.js';
import type {
  AgentServerCatalogue,
  CatalogueReadOptions,
  ProjectLocation,
} from './types.js';

/**
 * Key roots, for invalidating a whole family. Leaves are built by the
 * `queryOptions` factories below, which tag their keys with the result type so
 * `getQueryData` infers without a cast.
 */
export const runCenterKeys = {
  all: ['run-center'] as const,
  catalogues: () => [...runCenterKeys.all, 'catalogue'] as const,
  catalogue: (identity: string) =>
    [...runCenterKeys.catalogues(), identity] as const,
  projectLocations: () => [...runCenterKeys.all, 'project-locations'] as const,
};

/**
 * Teams, diaries and profiles the given identity can serve.
 *
 * Keyed by identity so switching identities reads a separate entry instead of
 * clearing and refilling one, which is what made a stale response able to land
 * under a newer selection.
 */
export function catalogueQuery(
  identity: string,
  // Injected so a view can be driven by a test double, as the rest of the
  // run center is; defaults to the real native bridge.
  read: (
    identity: string,
    options?: CatalogueReadOptions,
  ) => Promise<AgentServerCatalogue> = runCenterActions.catalogue,
) {
  return queryOptions({
    queryKey: runCenterKeys.catalogue(identity),
    queryFn: ({ client }): Promise<AgentServerCatalogue> =>
      takeCatalogueRefresh(client, identity)
        ? read(identity, { refresh: true })
        : read(identity),
    // An identity is only meaningful once one is selected.
    enabled: Boolean(identity),
  });
}

/**
 * Identities whose next catalogue read was explicitly asked for. The Agent
 * Server shares reads between its callers for a few seconds; a person pressing
 * Retry, or a renewal that just finished, must see the network's answer now.
 */
const refreshRequests = new WeakMap<QueryClient, Set<string>>();

export function requestCatalogueRefresh(
  client: QueryClient,
  identity: string,
): void {
  let identities = refreshRequests.get(client);
  if (!identities) {
    identities = new Set();
    refreshRequests.set(client, identities);
  }
  identities.add(identity);
}

function takeCatalogueRefresh(client: QueryClient, identity: string): boolean {
  return refreshRequests.get(client)?.delete(identity) ?? false;
}

/**
 * Folders registered for project work.
 *
 * `staleTime: 0` overrides the client default: these are machine-local and the
 * user edits them from another screen, so a reader coming back should see the
 * current list rather than a copy that is merely recent.
 */
export function projectLocationsQuery() {
  return queryOptions({
    staleTime: 0,
    queryKey: runCenterKeys.projectLocations(),
    queryFn: async (): Promise<ProjectLocation[]> =>
      (await projectActions.list()).locations,
  });
}
