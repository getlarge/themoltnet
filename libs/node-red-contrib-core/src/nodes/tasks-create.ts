import { randomUUID } from 'node:crypto';

import type { CreateTaskBody } from '@themoltnet/sdk';
import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { withAgent } from './agent-call.js';
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
    const active = new Map<number, string>();
    let nextInvocationId = 0;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const invocationId = ++nextInvocationId;
      let label = describeMessage(msg);
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('tasks-create: no moltnet-agent configured');
          }
          active.set(invocationId, label);
          this.status({
            fill: 'blue',
            shape: 'dot',
            text: statusText('creating', label, active.size),
          });

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
          label = describeTaskBody(base, label);
          active.set(invocationId, label);
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
          const task = await withAgent(agentNode, (agent) =>
            agent.tasks.create(createBody as CreateTaskBody, {
              teamId: teamId as string,
            }),
          );

          // Emit on a clone so fan-out wires don't share a mutated message.
          // The resolved correlationId is echoed onto msg.correlationId so
          // downstream task: wait / tasks: create / workflow: status inherit it.
          const out = RED.util.cloneMessage(msg);
          if (correlationId) out.correlationId = correlationId;
          out.taskId = task.id;
          out.payload = task;
          active.delete(invocationId);
          this.status({
            fill: 'green',
            shape: 'dot',
            text: statusText(`created ${shortId(task.id)}`, label, active.size),
          });
          send(out);
          done();
        } catch (err) {
          active.delete(invocationId);
          this.status({
            fill: 'red',
            shape: 'ring',
            text: statusText('error', label, active.size),
          });
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

function describeMessage(msg: NodeMessageInFlow): string {
  if (typeof msg.reviewDimension === 'string' && msg.reviewDimension) {
    return msg.reviewDimension;
  }
  const payload = msg.payload;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (typeof p.dimension === 'string' && p.dimension) return p.dimension;
    if (typeof p.title === 'string' && p.title) return p.title;
  }
  return 'task';
}

function describeTaskBody(
  body: Record<string, unknown>,
  fallback: string,
): string {
  if (fallback !== 'task') return fallback;
  const input = body.input;
  if (input && typeof input === 'object') {
    const execution = (input as Record<string, unknown>).execution;
    if (execution && typeof execution === 'object') {
      const dimension = (execution as Record<string, unknown>).dimension;
      if (typeof dimension === 'string' && dimension) return dimension;
    }
  }
  return typeof body.title === 'string' && body.title ? body.title : fallback;
}

function statusText(
  action: string,
  label: string,
  activeCount: number,
): string {
  const suffix = activeCount > 0 ? ` · ${activeCount} active` : '';
  return `${action} · ${truncate(label, 34)}${suffix}`;
}

function shortId(id: unknown): string {
  return typeof id === 'string' && id ? id.slice(0, 8) : 'task';
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export default init;
