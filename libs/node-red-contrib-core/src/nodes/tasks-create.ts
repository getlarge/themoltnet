import { randomUUID } from 'node:crypto';

import type { CreateTaskBody } from '@themoltnet/sdk';
import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import type { MoltnetRuntimeProfileNode } from './runtime-profile.js';

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
  runtimeProfile?: string; // id of an optional moltnet-runtime-profile config node
  maxAttempts?: number;
  generateCorrelationId?: boolean;
}

const init: NodeInitializer = (RED): void => {
  function TasksCreateNode(this: Node, def: TasksCreateDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;
    const profileNode = def.runtimeProfile
      ? (RED.nodes.getNode(
          def.runtimeProfile,
        ) as MoltnetRuntimeProfileNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('tasks-create: no moltnet-agent configured');
          }
          this.status({ fill: 'blue', shape: 'dot', text: 'creating…' });
          const agent = await agentNode.getAgent();

          // The task body is composed upstream by moltnet-task-builder and
          // arrives on msg.payload (taskType, title, tags, input, references,
          // gates…). This node submits it and fills only the dispatch-level
          // gaps: a freeform taskType fallback for ad-hoc payloads, the runtime
          // profile, maxAttempts, team/diary, and the correlationId.
          const base: Record<string, unknown> =
            msg.payload && typeof msg.payload === 'object'
              ? { ...(msg.payload as Record<string, unknown>) }
              : {};

          if (!base.taskType) base.taskType = 'freeform';
          // Runtime-profile config node: a routing gate set here (not in the
          // builder) since it pairs with which daemon claims the task. Only
          // fills the gap when msg.payload didn't already set allowedProfiles.
          if (!base.allowedProfiles && profileNode?.profileId) {
            base.allowedProfiles = [{ profileId: profileNode.profileId }];
          }
          if (
            base.maxAttempts === undefined &&
            typeof def.maxAttempts === 'number'
          ) {
            base.maxAttempts = def.maxAttempts;
          }

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
          if (correlationId) base.correlationId = correlationId;

          const { teamId, ...createBody } = base;
          const task = await agent.tasks.create(createBody as CreateTaskBody, {
            teamId: teamId as string,
          });

          // Emit on a clone so fan-out wires don't share a mutated message.
          // The resolved correlationId is echoed onto msg.correlationId so
          // downstream task: wait / tasks: create / workflow: status inherit it.
          const out = RED.util.cloneMessage(msg);
          if (correlationId) out.correlationId = correlationId;
          out.payload = task;
          this.status({
            fill: 'green',
            shape: 'dot',
            text: `task ${task.id ?? 'created'}`,
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
