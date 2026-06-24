import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';

/**
 * `moltnet-workflow-status` — reads the tasks of one workflow run (by
 * `correlationId`) via the SDK and emits a table-shaped `msg.payload` suitable
 * for a stock Dashboard 2.0 `ui-table` (or `ui-template`). This is the cockpit
 * source node: it turns MoltNet task state into rows a human can watch.
 *
 * No Dashboard dependency: it sits upstream of the stock widgets, which the
 * user wires the output into.
 */

interface WorkflowStatusDef extends NodeDef {
  agent?: string; // id of the referenced moltnet-agent config node
  correlationId?: string;
  limit?: number;
}

type AgentApi = Awaited<ReturnType<MoltnetAgentNode['getAgent']>>;
type ListTasksQuery = Parameters<AgentApi['tasks']['list']>[0];

interface StatusRow {
  taskId: string;
  type: string;
  title: string;
  status: string;
  queuedAt: string;
  completedAt: string;
}

const init: NodeInitializer = (RED): void => {
  function WorkflowStatusNode(this: Node, def: WorkflowStatusDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('workflow-status: no moltnet-agent configured');
          }
          const payload =
            msg.payload && typeof msg.payload === 'object'
              ? (msg.payload as { correlationId?: string })
              : {};
          const correlationId =
            (typeof msg.correlationId === 'string'
              ? msg.correlationId
              : undefined) ??
            payload.correlationId ??
            def.correlationId;
          if (!correlationId) {
            throw new Error('workflow-status: correlationId is required');
          }

          this.status({ fill: 'blue', shape: 'dot', text: 'loading…' });
          const teamId = agentNode.teamId;
          if (!teamId) {
            throw new Error('workflow-status: agent teamId is required');
          }
          const agent = await agentNode.getAgent();
          const query = {
            correlationId,
            limit: def.limit && def.limit > 0 ? def.limit : 50,
          } as ListTasksQuery;
          const res = await agent.tasks.list(query, { teamId });

          const rows: StatusRow[] = res.items.map((t) => ({
            taskId: t.id,
            type: t.taskType,
            title: t.title ?? '',
            status: t.status,
            queuedAt: t.queuedAt,
            completedAt: t.completedAt ?? '',
          }));

          const out = RED.util.cloneMessage(msg);
          out.payload = rows;
          out.workflow = { correlationId, total: res.total };
          this.status({
            fill: 'green',
            shape: 'dot',
            text: `${rows.length} task(s)`,
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

  RED.nodes.registerType('moltnet-workflow-status', WorkflowStatusNode);
};

export default init;
