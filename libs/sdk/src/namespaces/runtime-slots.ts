import {
  beginRuntimeSlot,
  findRuntimeProducerSlot,
  finishRuntimeSlot,
} from '@moltnet/api-client';

import type {
  RuntimeSlotRequestOptions,
  RuntimeSlotsNamespace,
} from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { MoltNetError } from '../errors.js';

export function createRuntimeSlotsNamespace(
  context: AgentContext,
): RuntimeSlotsNamespace {
  const { client, auth } = context;

  return {
    async begin(body, options) {
      return unwrapResult(
        await beginRuntimeSlot({
          client,
          auth,
          headers: teamHeaders(options),
          body,
        }),
      );
    },

    async finish(body, options) {
      return unwrapResult(
        await finishRuntimeSlot({
          client,
          auth,
          headers: teamHeaders(options),
          body,
        }),
      );
    },

    async findProducer(query, options) {
      try {
        return unwrapResult(
          await findRuntimeProducerSlot({
            client,
            auth,
            headers: teamHeaders(options),
            query,
          }),
        );
      } catch (err) {
        if (err instanceof MoltNetError && err.statusCode === 404) {
          return null;
        }
        throw err;
      }
    },
  };
}

function teamHeaders(options: RuntimeSlotRequestOptions): {
  'x-moltnet-team-id': string;
} {
  return { 'x-moltnet-team-id': options.teamId };
}
