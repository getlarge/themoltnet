import {
  createAgentKey,
  listAgentKeys,
  revokeAgentKey,
  rotateAgentKey,
} from '@moltnet/api-client';

import type {
  AgentKeyBindingRequestOptions,
  AgentKeysNamespace,
} from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { stripUndefinedQuery } from './query.js';
import { requiredTeamHeaders } from './team-headers.js';

function bindingHeaders(options: AgentKeyBindingRequestOptions) {
  return options.bindingScope === 'identity'
    ? {}
    : requiredTeamHeaders(options);
}

function bindingQuery<T extends Record<string, unknown> | undefined>(
  query: T,
  options: AgentKeyBindingRequestOptions,
) {
  return stripUndefinedQuery(
    options.bindingScope === 'identity'
      ? { ...query, bindingScope: 'identity' as const }
      : query,
  );
}

export function createAgentKeysNamespace(
  context: AgentContext,
): AgentKeysNamespace {
  const { client, auth } = context;

  return {
    async list(query, options) {
      // Drop keys whose value is undefined so absent filters (agentId, status,
      // cursor, limit) are never serialized, and so an all-undefined query and
      // an omitted query behave identically.
      return unwrapResult(
        await listAgentKeys({
          client,
          auth,
          headers: bindingHeaders(options),
          query: bindingQuery(query, options),
        }),
      );
    },

    async create(body, options) {
      return unwrapResult(
        await createAgentKey({
          client,
          auth,
          headers: {
            ...bindingHeaders(options),
            'idempotency-key': options.idempotencyKey,
          },
          body:
            options.bindingScope === 'identity'
              ? { ...body, bindingScope: 'identity' }
              : body,
        }),
      );
    },

    async rotate(keyId, options) {
      return unwrapResult(
        await rotateAgentKey({
          client,
          auth,
          headers: bindingHeaders(options),
          path: { keyId },
          query: bindingQuery(undefined, options),
        }),
      );
    },

    async revoke(keyId, body, options) {
      const result = await revokeAgentKey({
        client,
        auth,
        headers: bindingHeaders(options),
        path: { keyId },
        query: bindingQuery(undefined, options),
        body,
      });
      if (result.error) {
        unwrapResult(result);
      }
    },
  };
}
