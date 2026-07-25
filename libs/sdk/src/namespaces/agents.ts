import { getAgentProfile, verifyAgentSignature } from '@moltnet/api-client';

import type { AgentsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { createWhoami } from './whoami.js';

export function createAgentsNamespace(context: AgentContext): AgentsNamespace {
  const { client } = context;

  return {
    whoami: createWhoami(context),

    async lookup(fingerprint) {
      return unwrapResult(
        await getAgentProfile({
          client,
          path: { fingerprint },
        }),
      );
    },

    async verifySignature(fingerprint, body) {
      return unwrapResult(
        await verifyAgentSignature({
          client,
          path: { fingerprint },
          body,
        }),
      );
    },
  };
}
