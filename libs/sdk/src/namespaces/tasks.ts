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
  taskHeartbeat,
} from '@moltnet/api-client';

import type { TasksNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

function traceHeaders(context: AgentContext): Record<string, string> {
  return context.taskTraceHeaders ?? {};
}

export function createTasksNamespace(context: AgentContext): TasksNamespace {
  const { client, auth } = context;

  return {
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
      // Capture W3C trace headers from the response so subsequent calls
      // (heartbeat, messages, complete, fail) arrive as children of the
      // workflow trace rather than orphan spans in Axiom.
      const response = (result as { response?: Response }).response;
      if (response) {
        const headers: Record<string, string> = {};
        const traceparent = response.headers.get('traceparent');
        if (traceparent) {
          headers['traceparent'] = traceparent;
          const tracestate = response.headers.get('tracestate');
          if (tracestate) headers['tracestate'] = tracestate;
        }
        context.taskTraceHeaders = Object.keys(headers).length
          ? headers
          : undefined;
      }
      return unwrapResult(result);
    },

    async heartbeat(id, n, body) {
      return unwrapResult(
        await taskHeartbeat({
          client,
          auth,
          path: { id, n },
          body,
          headers: traceHeaders(context),
        }),
      );
    },

    async complete(id, n, body) {
      return unwrapResult(
        await completeTask({
          client,
          auth,
          path: { id, n },
          body,
          headers: traceHeaders(context),
        }),
      );
    },

    async fail(id, n, body) {
      return unwrapResult(
        await failTask({
          client,
          auth,
          path: { id, n },
          body,
          headers: traceHeaders(context),
        }),
      );
    },

    async cancel(id, body) {
      return unwrapResult(
        await cancelTask({
          client,
          auth,
          path: { id },
          body,
        }),
      );
    },

    async listAttempts(id) {
      return unwrapResult(
        await listTaskAttempts({
          client,
          auth,
          path: { id },
        }),
      );
    },

    async listMessages(id, n, query) {
      return unwrapResult(
        await listTaskMessages({
          client,
          auth,
          path: { id, n },
          query,
        }),
      );
    },

    async appendMessages(id, n, body) {
      return unwrapResult(
        await appendTaskMessages({
          client,
          auth,
          path: { id, n },
          body,
          headers: traceHeaders(context),
        }),
      );
    },
  };
}
