import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';

interface TasksListDef extends NodeDef {
  agent?: string;
  status?: string;
  statusList?: string;
  taskTypes?: string;
  tags?: string;
  excludeTags?: string;
  profileId?: string;
  correlationId?: string;
  diaryId?: string;
  proposedByAgentId?: string;
  proposedByHumanId?: string;
  claimedByAgentId?: string;
  hasAttempts?: boolean | string;
  queuedAfter?: string;
  queuedBefore?: string;
  completedAfter?: string;
  completedBefore?: string;
  limit?: number | string;
  cursor?: string;
}

type AgentApi = Awaited<ReturnType<MoltnetAgentNode['getAgent']>>;
type ListTasksQuery = NonNullable<Parameters<AgentApi['tasks']['list']>[0]>;

const init: NodeInitializer = (RED): void => {
  function TasksListNode(this: Node, def: TasksListDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('tasks-list: no moltnet-agent configured');
          }
          const teamId = agentNode.teamId;
          if (!teamId) {
            throw new Error('tasks-list: agent teamId is required');
          }

          this.status({ fill: 'blue', shape: 'dot', text: 'loading…' });
          const agent = await agentNode.getAgent();
          const query = buildTasksQuery(def, msg);
          const result = await agent.tasks.list(query, { teamId });

          const out = RED.util.cloneMessage(msg);
          out.payload = result.items;
          out.tasks = {
            total: result.total,
            nextCursor: result.nextCursor,
            query,
          };
          this.status({
            fill: 'green',
            shape: 'dot',
            text: `${result.items.length} task(s)`,
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

  RED.nodes.registerType('moltnet-tasks-list', TasksListNode);
};

function buildTasksQuery(
  def: TasksListDef,
  msg: NodeMessageInFlow,
): ListTasksQuery {
  const configured: Record<string, unknown> = {
    status: nonEmpty(def.status),
    statuses: csv(def.statusList),
    taskTypes: csv(def.taskTypes),
    tags: csv(def.tags),
    excludeTags: csv(def.excludeTags),
    profileId: nonEmpty(def.profileId),
    correlationId: nonEmpty(def.correlationId),
    diaryId: nonEmpty(def.diaryId),
    proposedByAgentId: nonEmpty(def.proposedByAgentId),
    proposedByHumanId: nonEmpty(def.proposedByHumanId),
    claimedByAgentId: nonEmpty(def.claimedByAgentId),
    hasAttempts: bool(def.hasAttempts),
    queuedAfter: nonEmpty(def.queuedAfter),
    queuedBefore: nonEmpty(def.queuedBefore),
    completedAfter: nonEmpty(def.completedAfter),
    completedBefore: nonEmpty(def.completedBefore),
    limit: positiveInt(def.limit),
    cursor: nonEmpty(def.cursor),
  };
  const payload =
    msg.payload && typeof msg.payload === 'object'
      ? (msg.payload as Record<string, unknown>)
      : {};
  return compact({ ...configured, ...payload }) as ListTasksQuery;
}

function csv(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.filter(
      (item): item is string => typeof item === 'string',
    );
    return items.length > 0 ? items : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

export default init;
