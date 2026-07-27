import type { Agent } from '@themoltnet/sdk';

import type { TaskClient } from './types.js';

/**
 * Adapt a connected MoltNet {@link Agent} into the engine's {@link TaskClient}.
 * Splits the `teamId` carried on the create body into the SDK's team-context
 * option, and pins message reads to a sane page size.
 */
export function createSdkTaskClient(agent: Agent): TaskClient {
  return {
    createTask(body) {
      const { teamId, ...createBody } = body;
      return agent.tasks.create(createBody, { teamId });
    },
    getTask(id) {
      return agent.tasks.get(id);
    },
    listAttempts(id) {
      return agent.tasks.listAttempts(id);
    },
    listMessages(id, attemptN) {
      return agent.tasks.listMessages(id, attemptN, { limit: 100 });
    },
  };
}
