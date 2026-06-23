import { randomUUID } from 'node:crypto';

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
 * Team/diary context comes from the **agent** config node (not this node): the
 * agent establishes who you are and which team/diary you act in. The task body
 * is taken from `msg.payload` when it is an object, otherwise a minimal body is
 * assembled from config. `teamId`/`diaryId` from the agent are merged in unless
 * the payload already sets them.
 *
 * `correlationId` threads a workflow run across tasks (mandatory for a workflow,
 * per #1422). It is resolved from `msg.correlationId` / `msg.payload.correlationId`;
 * when absent and `generateCorrelationId` is enabled, a fresh UUID is minted
 * (the proposer-mints-once pattern). The resolved id is always written back to
 * `msg.correlationId` so downstream nodes (`task: wait`, the next
 * `tasks: create`, `workflow: status`) inherit the same run.
 *
 * This node deliberately holds no SDK import: the SDK lives only in the config
 * node (Plane B), and the work happens through the connected Agent it hands back.
 */

interface TasksCreateDef extends NodeDef {
  agent?: string; // id of the referenced moltnet-agent config node
  taskType?: string;
  generateCorrelationId?: boolean;
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

          const base = (
            msg.payload && typeof msg.payload === 'object'
              ? { ...(msg.payload as Record<string, unknown>) }
              : { taskType: def.taskType || 'freeform' }
          ) as Record<string, unknown>;

          // Team/diary context comes from the agent unless the payload overrides
          // with a non-empty value.
          if (!base.teamId && agentNode.teamId) {
            base.teamId = agentNode.teamId;
          }
          if (!base.diaryId && agentNode.diaryId) {
            base.diaryId = agentNode.diaryId;
          }

          // Resolve (or mint) the workflow correlationId and thread it through.
          const correlationId = resolveCorrelationId(
            msg,
            base.correlationId,
            def.generateCorrelationId === true,
          );
          if (correlationId) {
            base.correlationId = correlationId;
            msg.correlationId = correlationId;
          }

          const task = await agent.tasks.create(base as CreateTaskBody);
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

/**
 * Resolve the workflow correlationId in priority order: explicit payload value,
 * then `msg.correlationId`, then mint a fresh UUID when generation is enabled.
 * Returns `undefined` when none is available and generation is off (the task is
 * then created without one — valid for ad-hoc, non-workflow tasks).
 */
function resolveCorrelationId(
  msg: NodeMessageInFlow,
  fromPayload: unknown,
  generate: boolean,
): string | undefined {
  if (typeof fromPayload === 'string' && fromPayload) return fromPayload;
  if (typeof msg.correlationId === 'string' && msg.correlationId) {
    return msg.correlationId;
  }
  return generate ? randomUUID() : undefined;
}

export default init;
