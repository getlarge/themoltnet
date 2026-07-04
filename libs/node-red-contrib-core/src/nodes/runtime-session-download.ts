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
  collectArtifactBody,
  requireAttemptContext,
  resolveMaxBytes,
} from './task-artifact-utils.js';

interface RuntimeSessionDownloadDef extends NodeDef {
  agent?: string;
  taskId?: string;
  teamId?: string;
  allowMsgTeamOverride?: boolean | string;
  attemptN?: number | string;
  maxBytes?: number | string;
}

const init: NodeInitializer = (RED): void => {
  function RuntimeSessionDownloadNode(
    this: Node,
    def: RuntimeSessionDownloadDef,
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
              'runtime-session-download: no moltnet-agent configured',
            );
          }
          const { taskId, teamId, attemptN } = requireAttemptContext(
            'runtime-session-download',
            msg,
            def.taskId,
            def.teamId,
            def.attemptN,
            agentNode,
            bool(def.allowMsgTeamOverride) ?? false,
          );

          this.status({ fill: 'blue', shape: 'dot', text: 'downloading…' });
          const stream = await withAgent(agentNode, (agent) =>
            agent.runtimeSessions.download({ taskId, attemptN }, { teamId }),
          );
          const body = await collectArtifactBody(
            stream,
            resolveMaxBytes(def.maxBytes),
            'runtime-session-download',
          );

          const out = RED.util.cloneMessage({
            ...msg,
            payload: undefined,
          }) as NodeMessageInFlow & Record<string, unknown>;
          out.payload = body;
          out.taskId = taskId;
          out.runtimeSession = {
            taskId,
            teamId,
            attemptN,
            sizeBytes: body.byteLength,
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
    'moltnet-runtime-session-download',
    RuntimeSessionDownloadNode,
  );
};

export default init;
