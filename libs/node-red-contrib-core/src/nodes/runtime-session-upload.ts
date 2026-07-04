import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { withAgent } from './agent-call.js';
import { bool, compact } from './query-utils.js';
import {
  requireAttemptContext,
  resolveField,
  resolveMaxBytes,
  resolveUploadBody,
} from './task-artifact-utils.js';

interface RuntimeSessionUploadDef extends NodeDef {
  agent?: string;
  taskId?: string;
  teamId?: string;
  allowMsgTeamOverride?: boolean | string;
  attemptN?: number | string;
  maxBytes?: number | string;
  sessionKind?: string;
  parentSessionId?: string;
  sourceSlotId?: string;
  sourceRuntimeProfileId?: string;
}

type AgentApi = Awaited<ReturnType<MoltnetAgentNode['getAgent']>>;
type UploadQuery = Parameters<AgentApi['runtimeSessions']['upload']>[2];

const init: NodeInitializer = (RED): void => {
  function RuntimeSessionUploadNode(
    this: Node,
    def: RuntimeSessionUploadDef,
  ): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error(
              'runtime-session-upload: no moltnet-agent configured',
            );
          }
          const { taskId, teamId, attemptN } = requireAttemptContext(
            'runtime-session-upload',
            msg,
            def.taskId,
            def.teamId,
            def.attemptN,
            agentNode,
            bool(def.allowMsgTeamOverride) ?? false,
          );
          const body = resolveUploadBody(
            msg,
            resolveMaxBytes(def.maxBytes),
            'runtime-session-upload',
          );
          const query = buildUploadQuery(def, msg);

          this.status({ fill: 'blue', shape: 'dot', text: 'uploading…' });
          const session = await withAgent(agentNode, (agent) =>
            agent.runtimeSessions.upload({ taskId, attemptN }, body, query, {
              teamId,
            }),
          );

          const out = RED.util.cloneMessage({
            ...msg,
            payload: undefined,
          }) as NodeMessageInFlow & Record<string, unknown>;
          out.payload = session;
          out.taskId = taskId;
          out.runtimeSession = session;
          this.status({
            fill: 'green',
            shape: 'dot',
            text: session.sha256 ?? 'uploaded',
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

  RED.nodes.registerType(
    'moltnet-runtime-session-upload',
    RuntimeSessionUploadNode,
  );
};

function buildUploadQuery(
  def: RuntimeSessionUploadDef,
  msg: NodeMessageInFlow,
): UploadQuery {
  return compact({
    sessionKind:
      resolveField(msg, 'sessionKind', def.sessionKind) ??
      resolveField(msg, 'session_kind', undefined) ??
      'root',
    parentSessionId:
      resolveField(msg, 'parentSessionId', def.parentSessionId) ??
      resolveField(msg, 'parent_session_id', undefined),
    sourceSlotId:
      resolveField(msg, 'sourceSlotId', def.sourceSlotId) ??
      resolveField(msg, 'source_slot_id', undefined),
    sourceRuntimeProfileId:
      resolveField(msg, 'sourceRuntimeProfileId', def.sourceRuntimeProfileId) ??
      resolveField(msg, 'source_runtime_profile_id', undefined),
  }) as UploadQuery;
}

export default init;
