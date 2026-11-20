import type { Dataset } from '../dataset.js';
import { validateDataset } from '../dataset.js';
import { hash } from '../hash.js';
import {
  type HumanEngineRequest,
  humanEngineRequest,
} from '../potato-origin.js';
import type { Workspace } from './types.js';

export interface CorpusManifest {
  schemaVersion: 1;
  datasetVersion: string;
  items: Array<{
    id: string;
    title: string;
    content: string;
    contentHash: string;
  }>;
}
export interface CorpusReview {
  engineRequest?: HumanEngineRequest;
  reviewer: string;
  decision: 'Approve unchanged' | 'Needs editing' | 'Exclude';
  entryHash: string;
  topics: string;
  notes: string;
  sourceHash: string;
  manifestHash: string;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}
function rows(jsonl: string) {
  return jsonl
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => object(JSON.parse(line)));
}

/** Bind the actual displayed task inputs to the captured dataset, before review. */
export function prepareCorpus(
  dataset: Dataset,
  itemsJsonl: string,
): CorpusManifest {
  validateDataset(dataset);
  const seen = new Set<string>();
  const items = rows(itemsJsonl).map((item) => {
    const entry = dataset.entries.find((e) => e.id === item.id);
    if (
      !entry ||
      seen.has(entry.id) ||
      item.content !== entry.content ||
      item.title !== (entry.title ?? '') ||
      item.contentHash !== entry.contentHash
    )
      throw new Error('Unknown, duplicate or stale corpus item');
    seen.add(entry.id);
    return {
      id: entry.id,
      title: entry.title ?? '',
      content: entry.content,
      contentHash: entry.contentHash,
    };
  });
  if (!items.length) throw new Error('No corpus items');
  return { schemaVersion: 1, datasetVersion: dataset.version, items };
}

/** Pure preview; the store scans and publishes the whole revision atomically. */
export function importCorpus(
  workspace: Workspace,
  manifest: CorpusManifest,
  jsonl: string,
  reviewer: string,
) {
  if (!reviewer.trim()) throw new Error('Select a human reviewer');
  if (
    manifest.schemaVersion !== 1 ||
    manifest.datasetVersion !== workspace.dataset.version
  )
    throw new Error('Stale corpus manifest');
  prepareCorpus(
    workspace.dataset,
    manifest.items.map((item) => JSON.stringify(item)).join('\n'),
  );
  const items = new Map(manifest.items.map((item) => [item.id, item]));
  const next = structuredClone(workspace);
  const seen = new Set<string>();
  const counts = { approved: 0, pending: 0, excluded: 0, unreviewed: 0 };
  for (const row of rows(jsonl)) {
    if (typeof row.user_id !== 'string')
      throw new Error('Missing annotator ID');
    if (row.user_id !== reviewer) continue;
    const engineRequest = humanEngineRequest(row, 'corpus_decision');
    const item =
      typeof row.instance_id === 'string'
        ? items.get(row.instance_id)
        : undefined;
    if (!item || seen.has(item.id))
      throw new Error('Unknown or duplicate reviewer instance');
    seen.add(item.id);
    const labels = object(row.labels);
    const choices = object(labels.corpus_decision ?? {});
    const keys = Object.keys(choices);
    if (!keys.length) {
      counts.unreviewed++;
      continue;
    }
    const decision = keys[0] as CorpusReview['decision'];
    if (
      keys.length !== 1 ||
      !['Approve unchanged', 'Needs editing', 'Exclude'].includes(decision) ||
      choices[decision] !== decision
    )
      throw new Error('Invalid corpus decision');
    const text = (key: string) => {
      const value = object(labels[key] ?? {}).text_box ?? '';
      if (typeof value !== 'string') throw new Error('Invalid review text');
      return value;
    };
    const topics = text('topics'),
      notes = text('review_notes');
    let proposed = item.content;
    const edits = Object.values(object(labels.proposed_body ?? {}));
    if (edits.length > 1) throw new Error('Ambiguous proposed edit');
    if (edits.length && edits[0] !== '') {
      if (typeof edits[0] !== 'string')
        throw new Error('Invalid proposed edit');
      const edit = object(JSON.parse(edits[0]));
      if (
        edit.original_text !== item.content ||
        typeof edit.edited_text !== 'string'
      )
        throw new Error('Stale or invalid proposed edit');
      proposed = edit.edited_text;
    }
    if (decision !== 'Needs editing' && proposed !== item.content)
      throw new Error('Changed text requires Needs editing');
    if (
      decision === 'Needs editing' &&
      proposed === item.content &&
      !notes.trim()
    )
      throw new Error('Needs editing requires a proposal or notes');
    if (
      next.drafts[item.id] &&
      (decision !== 'Needs editing' ||
        next.drafts[item.id].content !== proposed ||
        next.drafts[item.id].title !== item.title)
    )
      throw new Error('Existing draft conflicts with corpus import');
    (next.corpusReviews ??= {})[item.id] = {
      reviewer,
      engineRequest,
      decision,
      entryHash: item.contentHash,
      topics,
      notes,
      sourceHash: hash(jsonl),
      manifestHash: hash(manifest),
    };
    if (decision === 'Needs editing') {
      next.decisions[item.id] = 'pending';
      if (proposed !== item.content)
        next.drafts[item.id] = { title: item.title, content: proposed };
      counts.pending++;
    } else if (decision === 'Approve unchanged') {
      next.decisions[item.id] = 'approved';
      counts.approved++;
    } else {
      next.decisions[item.id] = 'excluded';
      counts.excluded++;
    }
  }
  if (!seen.size) throw new Error('Reviewer has no exported rows');
  const changed = hash(next) !== hash(workspace);
  if (changed) next.revision++;
  return {
    workspace: next,
    receipt: {
      reviewer,
      sourceHash: hash(jsonl),
      manifestHash: hash(manifest),
      previousRevision: workspace.revision,
      revision: next.revision,
      changed,
      ...counts,
    },
  };
}
