import {
  getLegreffierOnboardingStatus,
  startLegreffierOnboarding,
} from '@moltnet/api-client';

import type { LegreffierNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createLegreffierNamespace(
  context: AgentContext,
): LegreffierNamespace {
  const { client } = context;

  return {
    async startOnboarding(body) {
      return unwrapResult(await startLegreffierOnboarding({ client, body }));
    },

    async getOnboardingStatus(workflowId) {
      return unwrapResult(
        await getLegreffierOnboardingStatus({
          client,
          path: { workflowId },
        }),
      );
    },
  };
}
