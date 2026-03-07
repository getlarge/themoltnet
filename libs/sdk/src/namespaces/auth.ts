import { rotateClientSecret } from '@moltnet/api-client';

import type { AuthNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createAuthNamespace(context: AgentContext): AuthNamespace {
  const { client, auth } = context;

  return {
    async rotateSecret() {
      return unwrapResult(await rotateClientSecret({ client, auth }));
    },
  };
}
