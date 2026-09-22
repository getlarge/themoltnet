import { useEffect, useState } from 'react';

import type {
  AgentServerCatalogue,
  RunCenterActions,
  RunCenterData,
} from './types.js';
export const CATALOGUE_ERROR =
  'Teams and profiles could not be loaded. Retry to verify access.';
/** The run center owns its identity; only a different identity needs a local request. */
export function useComposerCatalogue(
  data: RunCenterData,
  actions: RunCenterActions,
  identity: string,
  active: boolean,
) {
  const owner =
    data.catalogueIdentity ??
    data.status?.selectedIdentity ??
    data.status?.agents[0]?.agentName;
  const shared = identity === owner;
  const [local, setLocal] = useState<{
    identity: string;
    catalogue: AgentServerCatalogue | null;
    loading: boolean;
    error: string | null;
  }>({ identity: '', catalogue: null, loading: false, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (shared || !active || !identity) return;
    let current = true;
    setLocal({ identity, catalogue: null, loading: true, error: null });
    void actions.catalogue(identity).then(
      (catalogue) => {
        if (current)
          setLocal({ identity, catalogue, loading: false, error: null });
      },
      () => {
        if (current)
          setLocal({
            identity,
            catalogue: null,
            loading: false,
            error: CATALOGUE_ERROR,
          });
      },
    );
    return () => {
      current = false;
    };
  }, [actions, identity, shared, active, revision]);
  return {
    catalogue: shared
      ? data.catalogue
      : local.identity === identity
        ? local.catalogue
        : null,
    loading: shared
      ? Boolean(data.catalogueLoading)
      : local.identity !== identity || local.loading,
    error: shared
      ? data.catalogueError
      : local.identity === identity
        ? local.error
        : null,
    retry: () => {
      if (shared && actions.refresh) void actions.refresh();
      else setRevision((value) => value + 1);
    },
  };
}
