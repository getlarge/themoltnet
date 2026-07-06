import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { withAgent } from './agent-call.js';

interface TaskCancelDef extends NodeDef {
  agent?: string;
  taskId?: string;
  reason?: string;
  skipMissing?: boolean;
  ignoreErrors?: boolean;
}

type AgentApi = Awaited<ReturnType<MoltnetAgentNode['getAgent']>>;
type Task = Awaited<ReturnType<AgentApi['tasks']['cancel']>>;

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

const init: NodeInitializer = (RED): void => {
  function TaskCancelNode(this: Node, def: TaskCancelDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('task-cancel: no moltnet-agent configured');
          }

          const taskIds = resolveTaskIds(msg, def.taskId);
          if (taskIds.length === 0) {
            if (def.skipMissing) {
              const out = RED.util.cloneMessage(msg);
              out.cancelledTasks = [];
              out.cancelErrors = [];
              this.status({
                fill: 'yellow',
                shape: 'ring',
                text: 'no task id',
              });
              send(out);
              done();
              return;
            }
            throw new Error('task-cancel: taskId is required');
          }

          this.status({
            fill: 'blue',
            shape: 'dot',
            text: `cancelling ${taskIds.length}`,
          });

          const reason = resolveReason(msg, def.reason);
          const cancelled: Task[] = [];
          const errors: Array<{ taskId: string; message: string }> = [];

          await withAgent(agentNode, async (agent) => {
            for (const taskId of taskIds) {
              try {
                const task = await agent.tasks.cancel(taskId, { reason });
                cancelled.push(task);
              } catch (error) {
                const message = errorMessage(error);
                if (!def.ignoreErrors) throw error;
                errors.push({ taskId, message });
              }
            }
          });

          const out = RED.util.cloneMessage(msg);
          out.cancelledTasks = cancelled;
          out.cancelErrors = errors;
          if (cancelled.length === 1) out.cancelledTask = cancelled[0];
          if (taskIds.length === 1) out.taskId = taskIds[0];
          this.status({
            fill: errors.length > 0 ? 'yellow' : 'green',
            shape: errors.length > 0 ? 'ring' : 'dot',
            text:
              errors.length > 0
                ? `cancelled ${cancelled.length}, ${errors.length} error(s)`
                : `cancelled ${cancelled.length}`,
          });
          send(out);
          done();
        } catch (err) {
          this.status({ fill: 'red', shape: 'ring', text: 'error' });
          done(err instanceof Error ? err : new Error(String(err)));
        }
      };
      void run();
    });
  }

  RED.nodes.registerType('moltnet-task-cancel', TaskCancelNode);
};

function resolveTaskIds(
  msg: NodeMessageInFlow,
  configured: string | undefined,
): string[] {
  const ids = new Set<string>();
  addId(ids, (msg as { taskId?: unknown }).taskId);
  addIds(ids, (msg as { taskIds?: unknown }).taskIds);
  collectFromPayload(ids, msg.payload);
  addId(ids, configured);
  return [...ids];
}

function collectFromPayload(ids: Set<string>, value: unknown): void {
  if (!value) return;
  if (typeof value === 'string') {
    addId(ids, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFromPayload(ids, item);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  addId(ids, record.taskId);
  addId(ids, record.id);
  addIds(ids, record.taskIds);
  addIds(ids, record.ids);
  if (Array.isArray(record.tasks)) addIds(ids, record.tasks);
  if (record.failure && typeof record.failure === 'object') {
    addId(ids, (record.failure as Record<string, unknown>).taskId);
  }
  if (
    typeof record.status === 'string' &&
    TERMINAL_STATUSES.has(record.status)
  ) {
    return;
  }
}

function addIds(ids: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) collectFromPayload(ids, item);
}

function addId(ids: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim()) ids.add(value.trim());
}

function resolveReason(msg: NodeMessageInFlow, configured: string | undefined) {
  if (configured && configured.trim()) return configured.trim();
  const payload = msg.payload;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (p.failure && typeof p.failure === 'object') {
      const failure = p.failure as Record<string, unknown>;
      const error = failure.error;
      if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string' && message.trim()) {
          return `workflow failed: ${message.trim()}`;
        }
      }
    }
  }
  return 'workflow failed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default init;
