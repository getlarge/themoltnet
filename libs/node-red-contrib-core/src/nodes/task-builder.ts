import { buildTask, TaskBuildError } from '@themoltnet/sdk';
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

/** A context row: maps a slug to a value pulled from msg/flow/global/literal. */
interface ContextMapping {
  slug: string;
  binding?: 'context_inline' | 'user_inline' | 'prompt_prefix' | 'skill';
  valueType: 'msg' | 'flow' | 'global' | 'str' | 'json';
  value: string;
}

interface TaskBuilderDef extends NodeDef {
  agent?: string;
  taskType?: string;
  brief?: string;
  /** Human-readable task title; falls back to `msg.payload.title`. */
  title?: string;
  /** Comma-separated task tags; falls back to `msg.payload.tags`. */
  tags?: string;
  /** Optional team override; falls back to the agent's team when blank. */
  teamId?: string;
  teamIdType?: ValueType;
  /** Optional diary override; falls back to the agent's diary when blank. */
  diaryId?: string;
  diaryIdType?: ValueType;
  contexts?: ContextMapping[];
  /** msg path to an `outputRef` (`{taskId, outputCid}`) from a prior task: read. */
  referencesFrom?: string;
  referencesRole?:
    | 'context'
    | 'judged_work'
    | 'reviewed_diff'
    | 'target_source';
  submitOutputGate?: boolean;
  schemaCid?: string;
  workspace?: 'none' | 'shared_mount' | 'dedicated_worktree';
  constraints?: string[];
  expectedOutput?: string;
}

/** Split a comma-separated config string into trimmed, non-empty values. */
function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Resolve a context mapping's raw value from the message / context stores / literal. */
function resolveValue(
  RED: Parameters<NodeInitializer>[0],
  node: Node,
  msg: NodeMessageInFlow,
  m: ContextMapping,
): unknown {
  switch (m.valueType) {
    case 'msg':
      return RED.util.getMessageProperty(msg, m.value) as unknown;
    case 'flow':
      return node.context().flow.get(m.value);
    case 'global':
      return node.context().global.get(m.value);
    case 'json':
      try {
        return JSON.parse(m.value) as unknown;
      } catch {
        return m.value;
      }
    case 'str':
    default:
      return m.value;
  }
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

        // Generic builder keyed on the configured task type (default freeform).
        // buildFreeform delegates to buildTask('freeform', ...) anyway, so the
        // gate/normalize behavior is identical for freeform.
        const taskType = def.taskType?.trim() || 'freeform';
        const builder = buildTask(taskType, { brief });

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

        // Context rows: resolve each value, then bind it. context_inline /
        // user_inline JSON-stringify objects automatically; other bindings
        // require a string, so non-strings are JSON-stringified here.
        for (const m of def.contexts ?? []) {
          if (!m?.slug) continue;
          const value = resolveValue(RED, this, msg, m);
          const binding = m.binding ?? 'context_inline';
          if (binding === 'context_inline') {
            builder.contextInline(m.slug, value);
          } else if (binding === 'user_inline') {
            builder.userInline(m.slug, value);
          } else {
            const content =
              typeof value === 'string' ? value : JSON.stringify(value);
            builder.context(m.slug, binding, content);
          }
        }

        // Reference a prior task's output, pulled from a msg path. The builder
        // re-stamps the role we pass, ignoring any role on the source ref.
        if (def.referencesFrom) {
          const ref = RED.util.getMessageProperty(msg, def.referencesFrom) as
            | { taskId: string | null; outputCid: string }
            | undefined;
          if (ref && ref.outputCid) {
            builder.references(ref, def.referencesRole ?? 'context');
          }
        }
        if (def.submitOutputGate) builder.requireSubmitOutput();
        if (def.schemaCid) builder.requireSchema(def.schemaCid);

        const inputPatch: Record<string, unknown> = {};
        if (def.workspace) inputPatch.execution = { workspace: def.workspace };
        if (def.constraints && def.constraints.length > 0)
          inputPatch.constraints = def.constraints;
        if (def.expectedOutput) inputPatch.expectedOutput = def.expectedOutput;
        if (Object.keys(inputPatch).length > 0) builder.input(inputPatch);

        // Top-level body fields: msg.payload wins, node config fills the gap
        // (mirrors the tasks-create precedence these fields moved away from).
        const title =
          typeof payloadInput.title === 'string' && payloadInput.title
            ? payloadInput.title
            : def.title?.trim();
        if (title) builder.title(title);

        const tags = Array.isArray(payloadInput.tags)
          ? (payloadInput.tags as string[])
          : parseCsv(def.tags);
        if (tags.length > 0) builder.tags(...tags);

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
