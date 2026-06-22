/**
 * `moltnet-tasks-create` — creates a MoltNet task via the SDK, acting as the
 * agent identity held by a referenced `moltnet-agent` config node.
 *
 * The task body is taken from `msg.payload` when it is an object, otherwise a
 * minimal body is assembled from the node's own config. This node deliberately
 * holds no SDK import: the SDK lives only in the config node (Plane B), and the
 * work happens through the connected Agent it hands back.
 */

interface TasksCreateConfig {
  name?: string;
  agent?: string; // id of the referenced moltnet-agent config node
  taskType?: string;
  teamId?: string;
}

interface StatusUpdate {
  fill: 'red' | 'green' | 'yellow' | 'blue' | 'grey';
  shape: 'ring' | 'dot';
  text: string;
}

interface NodeMessage {
  payload?: unknown;
  [key: string]: unknown;
}

interface AgentConfigNode {
  getAgent(): Promise<{
    tasks: { create(body: unknown): Promise<{ id?: string }> };
  }>;
}

interface TasksCreateNode {
  status(update: StatusUpdate | Record<string, never>): void;
  on(
    event: 'input',
    handler: (
      msg: NodeMessage,
      send: (msg: NodeMessage) => void,
      done: (err?: Error) => void,
    ) => void,
  ): void;
}

interface RED {
  nodes: {
    createNode(node: unknown, config: TasksCreateConfig): void;
    getNode(id: string): AgentConfigNode | null;
    registerType(
      type: string,
      ctor: (this: TasksCreateNode, config: TasksCreateConfig) => void,
    ): void;
  };
}

export default function (RED: RED): void {
  function TasksCreateNode(
    this: TasksCreateNode,
    config: TasksCreateConfig,
  ): void {
    RED.nodes.createNode(this, config);
    const agentNode = config.agent ? RED.nodes.getNode(config.agent) : null;

    this.on('input', (msg, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('tasks-create: no moltnet-agent configured');
          }
          this.status({ fill: 'blue', shape: 'dot', text: 'creating…' });
          const agent = await agentNode.getAgent();
          const body =
            msg.payload && typeof msg.payload === 'object'
              ? msg.payload
              : {
                  taskType: config.taskType || 'freeform',
                  teamId: config.teamId,
                };
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
}
