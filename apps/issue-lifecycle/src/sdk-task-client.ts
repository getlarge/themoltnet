import type { Agent } from '@themoltnet/sdk';

import type { TaskClient } from './types.js';

export function createSdkTaskClient(agent: Agent): TaskClient {
  return {
    createTask(body) {
      return agent.tasks.create(body);
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
