import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { withAgent } from './agent-call.js';
import {
  bool,
  compact,
  csv,
  finiteNumber,
  nonEmpty,
  nonNegativeInt,
  normalizeAliases,
  positiveInt,
} from './query-utils.js';

interface EntriesSearchDef extends NodeDef {
  agent?: string;
  diaryId?: string;
  query?: string;
  tags?: string;
  excludeTags?: string;
  entryTypes?: string;
  excludeSuperseded?: boolean | string;
  limit?: number | string;
  offset?: number | string;
  wRelevance?: number | string;
  wRecency?: number | string;
  wImportance?: number | string;
}

type AgentApi = Awaited<ReturnType<MoltnetAgentNode['getAgent']>>;
type EntrySearchBody = NonNullable<
  Parameters<AgentApi['entries']['search']>[0]
>;

const init: NodeInitializer = (RED): void => {
  function EntriesSearchNode(this: Node, def: EntriesSearchDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('entries-search: no moltnet-agent configured');
          }
          const body = buildSearchBody(def, msg, agentNode.diaryId);
          if (!body.query) {
            throw new Error('entries-search: query is required');
          }

          this.status({ fill: 'blue', shape: 'dot', text: 'searching…' });
          const result = await withAgent(agentNode, (agent) =>
            agent.entries.search(body),
          );

          const out = RED.util.cloneMessage(msg);
          out.payload = result.results;
          out.entries = {
            total: result.total,
            query: body,
          };
          this.status({
            fill: 'green',
            shape: 'dot',
            text: `${result.results.length} entr${result.results.length === 1 ? 'y' : 'ies'}`,
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

  RED.nodes.registerType('moltnet-entries-search', EntriesSearchNode);
};

function buildSearchBody(
  def: EntriesSearchDef,
  msg: NodeMessageInFlow,
  agentDiaryId?: string,
): EntrySearchBody {
  const configured: Record<string, unknown> = {
    diaryId: nonEmpty(def.diaryId) ?? nonEmpty(agentDiaryId),
    query: nonEmpty(def.query),
    tags: csv(def.tags),
    excludeTags: csv(def.excludeTags),
    entryTypes: csv(def.entryTypes),
    excludeSuperseded: bool(def.excludeSuperseded),
    limit: positiveInt(def.limit),
    offset: nonNegativeInt(def.offset),
    wRelevance: finiteNumber(def.wRelevance),
    wRecency: finiteNumber(def.wRecency),
    wImportance: finiteNumber(def.wImportance),
  };
  const payload =
    msg.payload && typeof msg.payload === 'object'
      ? normalizePayload(msg.payload as Record<string, unknown>)
      : typeof msg.payload === 'string'
        ? { query: msg.payload }
        : {};
  return compact({ ...configured, ...payload }) as EntrySearchBody;
}

function normalizePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return normalizeAliases(payload, {
    diary_id: 'diaryId',
    entry_types: 'entryTypes',
    exclude_superseded: 'excludeSuperseded',
    exclude_tags: 'excludeTags',
    w_importance: 'wImportance',
    w_recency: 'wRecency',
    w_relevance: 'wRelevance',
  });
}

export default init;
