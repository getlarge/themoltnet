import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { bool, nonEmpty } from './query-utils.js';
import {
  collectArtifactBody,
  payloadRecord,
  recordField,
  requireAttemptContext,
  resolveMaxBytes,
} from './task-artifact-utils.js';

interface TaskArtifactDownloadDef extends NodeDef {
  agent?: string;
  taskId?: string;
  teamId?: string;
  allowMsgTeamOverride?: boolean | string;
  attemptN?: number | string;
  maxBytes?: number | string;
  cid?: string;
}

const init: NodeInitializer = (RED): void => {
  function TaskArtifactDownloadNode(
    this: Node,
    def: TaskArtifactDownloadDef,
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
              'task-artifact-download: no moltnet-agent configured',
            );
          }
          const { taskId, teamId, attemptN } = requireAttemptContext(
            'task-artifact-download',
            msg,
            def.taskId,
            def.teamId,
            def.attemptN,
            agentNode,
            bool(def.allowMsgTeamOverride) ?? false,
          );
          const cid = resolveCid(msg, def.cid);
          if (!cid) throw new Error('task-artifact-download: cid is required');

          this.status({ fill: 'blue', shape: 'dot', text: 'downloading…' });
          const agent = await agentNode.getAgent();
          const result = await agent.tasks.artifacts.download(
            { taskId, attemptN, cid },
            { teamId },
          );
          const body = await collectArtifactBody(
            result,
            resolveMaxBytes(def.maxBytes),
          );

          const out = RED.util.cloneMessage({
            ...msg,
            payload: undefined,
          }) as NodeMessageInFlow & Record<string, unknown>;
          out.payload = body;
          out.taskId = taskId;
          out.artifact = {
            taskId,
            teamId,
            attemptN,
            cid,
            ...metadataFromResult(result),
          };
          this.status({
            fill: 'green',
            shape: 'dot',
            text: `${body.byteLength} byte(s)`,
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
    'moltnet-task-artifact-download',
    TaskArtifactDownloadNode,
  );
};

function resolveCid(
  msg: NodeMessageInFlow,
  configured: unknown,
): string | undefined {
  if (typeof msg.cid === 'string' && msg.cid) return msg.cid;
  const payload = payloadRecord(msg);
  return (
    nonEmpty(payload.cid) ??
    nonEmpty(recordField(payload.artifact, 'cid')) ??
    nonEmpty(configured)
  );
}

function metadataFromResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const record = result as Record<string, unknown>;
  return {
    artifactId: record.artifactId,
    contentType: record.contentType,
    contentEncoding: record.contentEncoding,
  };
}

export default init;
