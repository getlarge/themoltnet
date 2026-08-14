import {
  createAgentEnrollment,
  revokeAgentEnrollment,
} from '@moltnet/api-client';

import type { AgentEnrollmentsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { requiredTeamHeaders } from './team-headers.js';

export function createAgentEnrollmentsNamespace(
  context: AgentContext,
): AgentEnrollmentsNamespace {
  const { client, auth } = context;
  return {
    async create(body, options) {
      return unwrapResult(
        await createAgentEnrollment({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          body,
        }),
      );
    },

    async revoke(id, options) {
      const result = await revokeAgentEnrollment({
        client,
        auth,
        headers: requiredTeamHeaders(options),
        path: { id },
      });
      if (result.error) unwrapResult(result);
    },
  };
}
