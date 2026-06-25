import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';

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
type EntrySearchBody = Parameters<AgentApi['entries']['search']>[0];

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
          const agent = await agentNode.getAgent();
          const result = await agent.entries.search(body);

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
    wRelevance: number(def.wRelevance),
    wRecency: number(def.wRecency),
    wImportance: number(def.wImportance),
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
  const normalized = { ...payload };
  if (normalized.diary_id !== undefined && normalized.diaryId === undefined) {
    normalized.diaryId = normalized.diary_id;
    delete normalized.diary_id;
  }
  if (
    normalized.entry_types !== undefined &&
    normalized.entryTypes === undefined
  ) {
    normalized.entryTypes = normalized.entry_types;
    delete normalized.entry_types;
  }
  if (
    normalized.exclude_superseded !== undefined &&
    normalized.excludeSuperseded === undefined
  ) {
    normalized.excludeSuperseded = normalized.exclude_superseded;
    delete normalized.exclude_superseded;
  }
  if (
    normalized.exclude_tags !== undefined &&
    normalized.excludeTags === undefined
  ) {
    normalized.excludeTags = normalized.exclude_tags;
    delete normalized.exclude_tags;
  }
  return normalized;
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

function nonNegativeInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

function number(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
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
