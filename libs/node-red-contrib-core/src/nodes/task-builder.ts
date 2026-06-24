import { buildFreeform, TaskBuildError } from '@themoltnet/sdk';
import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';

/**
 * `moltnet-task-builder` — composes a validated MoltNet `tasks.create` body
 * from node config + the incoming message, using the SDK fluent builder. Pure
 * transform: it reads `teamId`/`diaryId` synchronously from the referenced
 * agent config node but never calls the network.
 *
 * The SDK's `build()` returns a `BuiltTask` envelope `{ body, teamId }` — the
 * team travels as the `x-moltnet-team-id` header, not inside the body. To feed
 * a downstream `moltnet-tasks-create` (which does `const { teamId, ...createBody }
 * = msg.payload`), this node flattens that envelope back into a single
 * `msg.payload` of shape `{ ...body, teamId }`. Validation failures surface as
 * node errors (red ring) with field-level detail.
 */

/** typedInput value-source kinds for the team/diary overrides. */
type ValueType = 'str' | 'msg' | 'flow' | 'global';

interface TaskBuilderDef extends NodeDef {
  agent?: string;
  taskType?: string;
  brief?: string;
  /** Optional team override; falls back to the agent's team when blank. */
  teamId?: string;
  teamIdType?: ValueType;
  /** Optional diary override; falls back to the agent's diary when blank. */
  diaryId?: string;
  diaryIdType?: ValueType;
}

/**
 * Resolve a typedInput override (literal or msg/flow/global path). Returns
 * `undefined` when the value field is blank so the caller can fall back to the
 * agent default.
 */
export function resolveOverride(
  RED: Parameters<NodeInitializer>[0],
  node: Node,
  msg: NodeMessageInFlow,
  value: string | undefined,
  type: ValueType | undefined,
): string | undefined {
  if (!value) return undefined;
  switch (type) {
    case 'msg': {
      const v: unknown = RED.util.getMessageProperty(msg, value);
      return typeof v === 'string' && v ? v : undefined;
    }
    case 'flow': {
      const v = node.context().flow.get(value);
      return typeof v === 'string' && v ? v : undefined;
    }
    case 'global': {
      const v = node.context().global.get(value);
      return typeof v === 'string' && v ? v : undefined;
    }
    case 'str':
    default:
      return value;
  }
}

const init: NodeInitializer = (RED): void => {
  function TaskBuilderNode(this: Node, def: TaskBuilderDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      try {
        const payloadInput =
          msg.payload && typeof msg.payload === 'object'
            ? (msg.payload as Record<string, unknown>)
            : {};

        // msg wins, config fills the gaps.
        const brief =
          typeof (payloadInput.input as { brief?: unknown } | undefined)
            ?.brief === 'string'
            ? (payloadInput.input as { brief: string }).brief
            : (def.brief ?? '');

        const builder = buildFreeform({ brief });

        // Team/diary: explicit override (node typedInput, or msg.payload) →
        // agent default. The override fields make precedence visible in the
        // editor; the agent context is the fallback.
        const teamId =
          resolveOverride(RED, this, msg, def.teamId, def.teamIdType) ??
          (payloadInput.teamId as string | undefined) ??
          agentNode?.teamId;
        const diaryId =
          resolveOverride(RED, this, msg, def.diaryId, def.diaryIdType) ??
          (payloadInput.diaryId as string | undefined) ??
          agentNode?.diaryId;
        if (teamId) builder.team(teamId);
        if (diaryId) builder.diary(diaryId);

        const built = builder.build();

        const out = RED.util.cloneMessage(msg);
        // Flatten the BuiltTask envelope: spread the body and re-attach teamId
        // as a sibling field so moltnet-tasks-create can split it back out.
        out.payload = { ...built.body, teamId: built.teamId };
        this.status({ fill: 'green', shape: 'dot', text: 'built' });
        send(out);
        done();
      } catch (err) {
        this.status({ fill: 'red', shape: 'ring', text: 'error' });
        const e =
          err instanceof TaskBuildError
            ? new Error(err.message)
            : err instanceof Error
              ? err
              : new Error(String(err));
        done(e);
      }
    });
  }

  RED.nodes.registerType('moltnet-task-builder', TaskBuilderNode);
};

export default init;
