import {
  getAgentProfile,
  getWhoami,
  verifyAgentSignature,
} from '@moltnet/api-client';

import type { AgentsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createAgentsNamespace(context: AgentContext): AgentsNamespace {
  const { client, auth } = context;

  return {
    async whoami() {
      return unwrapResult(await getWhoami({ client, auth }));
    },

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
