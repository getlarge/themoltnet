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
  resolveField,
  resolveMaxBytes,
  resolveTeamId,
  resolveUploadBody,
} from './task-artifact-utils.js';

interface TaskArtifactStageDef extends NodeDef {
  agent?: string;
  teamId?: string;
  allowMsgTeamOverride?: boolean | string;
  maxBytes?: number | string;
  contentType?: string;
  contentEncoding?: string;
}

const init: NodeInitializer = (RED): void => {
  function TaskArtifactStageNode(this: Node, def: TaskArtifactStageDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('task-artifact-stage: no moltnet-agent configured');
          }
          const teamId = resolveTeamId(
            msg,
            def.teamId,
            agentNode,
            bool(def.allowMsgTeamOverride) ?? false,
          );
          if (!teamId)
            throw new Error('task-artifact-stage: teamId is required');

          const body = resolveUploadBody(
            msg,
            resolveMaxBytes(def.maxBytes),
            'task-artifact-stage',
          );
          const query = {
            contentType: resolveField(msg, 'contentType', def.contentType),
            contentEncoding: resolveField(
              msg,
              'contentEncoding',
              def.contentEncoding,
            ),
          };

          this.status({ fill: 'blue', shape: 'dot', text: 'staging...' });
          const artifact = await withAgent(agentNode, (agent) =>
            agent.tasks.artifacts.stage(body, query, { teamId }),
          );

          const out = RED.util.cloneMessage({
            ...msg,
            payload: undefined,
          }) as NodeMessageInFlow & Record<string, unknown>;
          out.payload = artifact;
          out.artifact = artifact;
          this.status({ fill: 'green', shape: 'dot', text: artifact.cid });
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

  RED.nodes.registerType('moltnet-task-artifact-stage', TaskArtifactStageNode);
};

export default init;
