import {
  beginRuntimeSlot,
  findLatestRuntimeSlotForAttempt,
  finishRuntimeSlot,
} from '@moltnet/api-client';

import type { RuntimeSlotsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { MoltNetError } from '../errors.js';
import { requiredTeamHeaders as teamHeaders } from './team-headers.js';

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

    async findLatestForAttempt(query, options) {
      try {
        return unwrapResult(
          await findLatestRuntimeSlotForAttempt({
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
