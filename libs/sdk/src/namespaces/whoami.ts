import { getWhoami, type Whoami } from '@moltnet/api-client';

import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

/**
 * Build a `whoami()` accessor bound to an authenticated context. Returns the
 * caller's identity and context: `subjectType`, `currentTeamId`, and, for an
 * agent authenticated via an agent key, its `credentialBinding`.
 */
export function createWhoami(context: AgentContext): () => Promise<Whoami> {
  const { client, auth } = context;
  return async () => unwrapResult(await getWhoami({ client, auth }));
}
