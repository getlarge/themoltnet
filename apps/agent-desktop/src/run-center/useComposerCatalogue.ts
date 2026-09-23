import type { AgentServerCatalogue } from './types.js';
import { useCatalogue } from './useCatalogue.js';

export { CATALOGUE_ERROR } from './useCatalogue.js';

/**
 * The composer's catalogue for whichever identity it is offering.
 *
 * This used to branch: when the composer showed the run center's own identity
 * it read the parent's prop-drilled state, and otherwise it kept a second copy
 * with its own loading flag, error string and retry counter. Those two paths
 * disagreed, which is where the duplicated fetches and conflicting messages
 * came from. There is one cache entry per identity now, so the branch is gone
 * and the composer is an ordinary reader.
 */
export function useComposerCatalogue(
  identity: string,
  active: boolean,
  read?: (identity: string) => Promise<AgentServerCatalogue>,
) {
  return useCatalogue(identity, { active, read });
}
