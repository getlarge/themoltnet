import {
  createTaskGrant,
  listTaskGrants,
  revokeTaskGrant,
} from '@moltnet/api-client';

import type { TaskGrantsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { requiredTeamHeaders } from './team-headers.js';

export function createTaskGrantsNamespace(
  context: AgentContext,
): TaskGrantsNamespace {
  const { client, auth } = context;

  return {
    async create(taskId, body, options) {
      return unwrapResult(
        await createTaskGrant({
          client,
          auth,
          path: { id: taskId },
          body,
          headers: requiredTeamHeaders(options),
        }),
      );
    },

    async list(taskId, options) {
      return unwrapResult(
        await listTaskGrants({
          client,
          auth,
          path: { id: taskId },
          headers: requiredTeamHeaders(options),
        }),
      );
    },

    async revoke(taskId, body, options) {
      return unwrapResult(
        await revokeTaskGrant({
          client,
          auth,
          path: { id: taskId },
          body,
          headers: requiredTeamHeaders(options),
        }),
      );
    },
  };
}
