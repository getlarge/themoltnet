import {
  appendTaskMessages,
  cancelTask,
  claimTask,
  completeTask,
  createTask,
  failTask,
  getTask,
  listTaskAttempts,
  listTaskMessages,
  listTasks,
  listTaskSchemas,
  taskHeartbeat,
} from '@moltnet/api-client';

import type { TasksNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createTasksNamespace(context: AgentContext): TasksNamespace {
  const { client, auth } = context;

  return {
    async schemas() {
      return unwrapResult(await listTaskSchemas({ client, auth }));
    },

    async list(query) {
      return unwrapResult(await listTasks({ client, auth, query }));
    },

    async create(body) {
      return unwrapResult(await createTask({ client, auth, body }));
    },

    async get(id) {
      return unwrapResult(await getTask({ client, auth, path: { id } }));
    },

    async claim(id, body) {
      const result = await claimTask({ client, auth, path: { id }, body });
      const data = unwrapResult(result);
      const traceHeaders: Record<string, string> = {};
      const traceparent = result.response.headers.get('traceparent');
      if (traceparent) {
        traceHeaders['traceparent'] = traceparent;
        const tracestate = result.response.headers.get('tracestate');
        if (tracestate) traceHeaders['tracestate'] = tracestate;
      }
      return { ...data, traceHeaders };
    },

    async heartbeat(id, n, body) {
      return unwrapResult(
        await taskHeartbeat({ client, auth, path: { id, n }, body }),
      );
    },

    async complete(id, n, body) {
      return unwrapResult(
        await completeTask({ client, auth, path: { id, n }, body }),
      );
    },

    async fail(id, n, body) {
      return unwrapResult(
        await failTask({ client, auth, path: { id, n }, body }),
      );
    },

    async cancel(id, body) {
      return unwrapResult(
        await cancelTask({ client, auth, path: { id }, body }),
      );
    },

    async listAttempts(id) {
      return unwrapResult(
        await listTaskAttempts({ client, auth, path: { id } }),
      );
    },

    async listMessages(id, n, query) {
      return unwrapResult(
        await listTaskMessages({ client, auth, path: { id, n }, query }),
      );
    },

    async appendMessages(id, n, body) {
      return unwrapResult(
        await appendTaskMessages({ client, auth, path: { id, n }, body }),
      );
    },
  };
}
