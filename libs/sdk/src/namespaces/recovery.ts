import {
  requestRecoveryChallenge,
  verifyRecoveryChallenge,
} from '@moltnet/api-client';

import type { RecoveryNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createRecoveryNamespace(
  context: AgentContext,
): RecoveryNamespace {
  const { client } = context;

  return {
    async requestChallenge(body) {
      return unwrapResult(
        await requestRecoveryChallenge({ client, body: body as never }),
      );
    },

    async verifyChallenge(body) {
      return unwrapResult(
        await verifyRecoveryChallenge({ client, body: body as never }),
      );
    },
  };
}
