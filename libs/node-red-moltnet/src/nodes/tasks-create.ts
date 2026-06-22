import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';

/**
 * `moltnet-tasks-create` — creates a MoltNet task via the SDK, acting as the
 * agent identity held by a referenced `moltnet-agent` config node.
 *
 * The task body is taken from `msg.payload` when it is an object, otherwise a
 * minimal body is assembled from the node's own config. This node deliberately
 * holds no SDK import: the SDK lives only in the config node (Plane B), and the
 * work happens through the connected Agent it hands back.
 */

interface TasksCreateDef extends NodeDef {
  agent?: string; // id of the referenced moltnet-agent config node
  taskType?: string;
  teamId?: string;
}

type AgentApi = Awaited<ReturnType<MoltnetAgentNode['getAgent']>>;
type CreateTaskBody = Parameters<AgentApi['tasks']['create']>[0];

const init: NodeInitializer = (RED): void => {
  function TasksCreateNode(this: Node, def: TasksCreateDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('tasks-create: no moltnet-agent configured');
          }
          this.status({ fill: 'blue', shape: 'dot', text: 'creating…' });
          const agent = await agentNode.getAgent();
          const body = (
            msg.payload && typeof msg.payload === 'object'
              ? msg.payload
              : { taskType: def.taskType || 'freeform', teamId: def.teamId }
          ) as CreateTaskBody;
          const task = await agent.tasks.create(body);
          msg.payload = task;
          this.status({
            fill: 'green',
            shape: 'dot',
            text: `task ${task.id ?? 'created'}`,
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

  RED.nodes.registerType('moltnet-tasks-create', TasksCreateNode);
};

export default init;
