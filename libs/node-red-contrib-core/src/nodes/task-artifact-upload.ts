import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { withAgent } from './agent-call.js';
import { bool } from './query-utils.js';
import {
  requireAttemptContext,
  resolveField,
  resolveMaxBytes,
  resolveUploadBody,
} from './task-artifact-utils.js';

interface TaskArtifactUploadDef extends NodeDef {
  agent?: string;
  taskId?: string;
  teamId?: string;
  allowMsgTeamOverride?: boolean | string;
  attemptN?: number | string;
  maxBytes?: number | string;
  kind?: string;
  title?: string;
  contentType?: string;
  contentEncoding?: string;
}

type AgentApi = Awaited<ReturnType<MoltnetAgentNode['getAgent']>>;
type UploadQuery = NonNullable<
  Parameters<AgentApi['tasks']['artifacts']['upload']>[2]
>;

const init: NodeInitializer = (RED): void => {
  function TaskArtifactUploadNode(
    this: Node,
    def: TaskArtifactUploadDef,
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
              'task-artifact-upload: no moltnet-agent configured',
            );
          }
          const { taskId, teamId, attemptN } = requireAttemptContext(
            'task-artifact-upload',
            msg,
            def.taskId,
            def.teamId,
            def.attemptN,
            agentNode,
            bool(def.allowMsgTeamOverride) ?? false,
          );
          const maxBytes = resolveMaxBytes(def.maxBytes);
          const body = resolveUploadBody(msg, maxBytes);
          const query = buildUploadQuery(def, msg);

          this.status({ fill: 'blue', shape: 'dot', text: 'uploading…' });
          const artifact = await withAgent(agentNode, (agent) =>
            agent.tasks.artifacts.upload({ taskId, attemptN }, body, query, {
              teamId,
            }),
          );

          const out = RED.util.cloneMessage({
            ...msg,
            payload: undefined,
          }) as NodeMessageInFlow & Record<string, unknown>;
          out.payload = artifact;
          out.taskId = taskId;
          out.artifact = artifact;
          this.status({
            fill: 'green',
            shape: 'dot',
            text: artifact.cid,
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
    'moltnet-task-artifact-upload',
    TaskArtifactUploadNode,
  );
};

function buildUploadQuery(
  def: TaskArtifactUploadDef,
  msg: NodeMessageInFlow,
): UploadQuery {
  return {
    kind: resolveField(msg, 'kind', def.kind) ?? 'output',
    title: resolveField(msg, 'title', def.title) ?? 'artifact',
    contentType:
      resolveField(msg, 'contentType', def.contentType) ??
      'application/octet-stream',
    contentEncoding: resolveField(msg, 'contentEncoding', def.contentEncoding),
  };
}

export default init;
