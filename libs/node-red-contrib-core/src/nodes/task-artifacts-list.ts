import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { bool, compact, nonEmpty, positiveInt } from './query-utils.js';
import {
  payloadRecord,
  requireArtifactContext,
} from './task-artifact-utils.js';

interface TaskArtifactsListDef extends NodeDef {
  agent?: string;
  taskId?: string;
  teamId?: string;
  allowMsgTeamOverride?: boolean | string;
  limit?: number | string;
  cursor?: string;
}

type AgentApi = Awaited<ReturnType<MoltnetAgentNode['getAgent']>>;
type ListPageQuery = Parameters<AgentApi['tasks']['artifacts']['listPage']>[1];

const init: NodeInitializer = (RED): void => {
  function TaskArtifactsListNode(this: Node, def: TaskArtifactsListDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('task-artifacts-list: no moltnet-agent configured');
          }
          const { taskId, teamId } = requireArtifactContext(
            'task-artifacts-list',
            msg,
            def.taskId,
            def.teamId,
            agentNode,
            bool(def.allowMsgTeamOverride) ?? false,
          );

          this.status({ fill: 'blue', shape: 'dot', text: 'loading…' });
          const agent = await agentNode.getAgent();
          const query = buildQuery(def, msg);
          const page = await agent.tasks.artifacts.listPage(taskId, query, {
            teamId,
          });

          const out = RED.util.cloneMessage(msg);
          out.payload = page.artifacts;
          out.taskId = taskId;
          out.artifacts = {
            taskId,
            teamId,
            query,
            count: page.artifacts.length,
            nextCursor: page.nextCursor,
            page,
          };
          this.status({
            fill: 'green',
            shape: 'dot',
            text: `${page.artifacts.length} artifact(s)`,
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

  RED.nodes.registerType('moltnet-task-artifacts-list', TaskArtifactsListNode);
};

function buildQuery(
  def: TaskArtifactsListDef,
  msg: NodeMessageInFlow,
): ListPageQuery {
  const payload = payloadRecord(msg);
  return compact({
    limit: positiveInt(payload.limit) ?? positiveInt(def.limit),
    cursor: nonEmpty(payload.cursor) ?? nonEmpty(def.cursor),
  }) as ListPageQuery;
}

export default init;
