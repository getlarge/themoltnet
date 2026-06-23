import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { buildTaskSnapshot } from './task-snapshot.js';

/**
 * `moltnet-task-get` — one-shot read of a MoltNet task and its attempts via the
 * SDK. No polling: it fetches `tasks.get(id)` plus `tasks.listAttempts(id)` once
 * and emits a normalized snapshot (see {@link buildTaskSnapshot}).
 *
 * Use it for switch/branch logic and dashboards where the caller already knows
 * the task may not be terminal. For "block until the run settles", use
 * `moltnet-task-wait` instead.
 */

interface TaskGetDef extends NodeDef {
  agent?: string; // id of the referenced moltnet-agent config node
  taskId?: string;
}

const init: NodeInitializer = (RED): void => {
  function TaskGetNode(this: Node, def: TaskGetDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('task-get: no moltnet-agent configured');
          }
          const taskId = resolveTaskId(msg, def.taskId);
          if (!taskId) {
            throw new Error('task-get: taskId is required');
          }

          this.status({ fill: 'blue', shape: 'dot', text: 'loading…' });
          const agent = await agentNode.getAgent();
          const [task, attempts] = await Promise.all([
            agent.tasks.get(taskId),
            agent.tasks.listAttempts(taskId),
          ]);
          const snapshot = buildTaskSnapshot(task, attempts);

          msg.payload = snapshot;
          this.status({
            fill: snapshot.accepted ? 'green' : 'grey',
            shape: 'dot',
            text: `${snapshot.status}${snapshot.accepted ? ' ✓' : ''}`,
          });
          send(msg);
          done();
        } catch (err) {
          this.status({ fill: 'red', shape: 'ring', text: 'error' });
          done(err instanceof Error ? err : new Error(String(err)));
        }
      };
      void run();
    });
  }

  RED.nodes.registerType('moltnet-task-get', TaskGetNode);
};

/**
 * Resolve the task id from the message (in priority order) or fall back to the
 * node's configured id. Accepts both `msg.payload.taskId` and the shape emitted
 * by `moltnet-tasks-create` (`msg.payload.id`).
 */
function resolveTaskId(
  msg: NodeMessageInFlow,
  configured: string | undefined,
): string | undefined {
  if (typeof msg.taskId === 'string' && msg.taskId) return msg.taskId;
  const payload = msg.payload;
  if (payload && typeof payload === 'object') {
    const p = payload as { taskId?: unknown; id?: unknown };
    if (typeof p.taskId === 'string' && p.taskId) return p.taskId;
    if (typeof p.id === 'string' && p.id) return p.id;
  }
  return configured && configured.length > 0 ? configured : undefined;
}

export default init;
