import {
  createAgentKey,
  listAgentKeys,
  revokeAgentKey,
  rotateAgentKey,
} from '@moltnet/api-client';

import type { AgentKeysNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { requiredTeamHeaders } from './team-headers.js';

export function createAgentKeysNamespace(
  context: AgentContext,
): AgentKeysNamespace {
  const { client, auth } = context;

  return {
    async list(options, query) {
      return unwrapResult(
        await listAgentKeys({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          query,
        }),
      );
    },

    async create(body, options) {
      return unwrapResult(
        await createAgentKey({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          body,
        }),
      );
    },

    async rotate(keyId, options) {
      return unwrapResult(
        await rotateAgentKey({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          path: { keyId },
        }),
      );
    },

    async revoke(keyId, body, options) {
      const result = await revokeAgentKey({
        client,
        auth,
        headers: requiredTeamHeaders(options),
        path: { keyId },
        body,
      });
      if (result.error) {
        unwrapResult(result);
      }
    },
  };
}
