import {
  beginDaemonRuntimeSlot,
  findDaemonRuntimeProducerSlot,
  finishDaemonRuntimeSlot,
} from '@moltnet/api-client';

import type { DaemonRuntimeSlotsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { MoltNetError } from '../errors.js';

export function createDaemonRuntimeSlotsNamespace(
  context: AgentContext,
): DaemonRuntimeSlotsNamespace {
  const { client, auth } = context;

  return {
    async begin(body) {
      return unwrapResult(await beginDaemonRuntimeSlot({ client, auth, body }));
    },

    async finish(body) {
      return unwrapResult(
        await finishDaemonRuntimeSlot({ client, auth, body }),
      );
    },

    async findProducer(query) {
      try {
        return unwrapResult(
          await findDaemonRuntimeProducerSlot({ client, auth, query }),
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
