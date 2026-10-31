import type { Dataset, Judgment } from './dataset.js';
import { validateDataset } from './dataset.js';
import { hash } from './hash.js';
import { annotationQueue, type Ranking } from './metrics.js';
import {
  type HumanEngineRequest,
  humanEngineRequest,
} from './potato-origin.js';

export interface PotatoManifest {
  schemaVersion: 1;
  datasetHash: string;
  items: Array<{
    id: string;
    queryId: string;
    entryId: string;
    queryHash: string;
    entryHash: string;
    query: string;
    content: string;
  }>;
}

/** Call only on an approved, sanitized dataset. No source mappings are exported. */
export function preparePotato(
  dataset: Dataset,
  rankings: Ranking[],
  fullCorpus = false,
): PotatoManifest {
  validateDataset(dataset);
  const items: PotatoManifest['items'] = [];
  for (const query of dataset.queries) {
    for (const entryId of fullCorpus
      ? dataset.entries.map((entry) => entry.id)
      : annotationQueue(rankings, query.id)) {
      const entry = dataset.entries.find((entry) => entry.id === entryId);
      if (!entry) throw new Error('Unknown candidate entry');
      items.push({
        id: hash([query.id, entry.id, query.textHash, entry.contentHash]),
        queryId: query.id,
        entryId: entry.id,
        queryHash: query.textHash,
        entryHash: entry.contentHash,
        query: query.text,
        content: [entry.title, entry.content].filter(Boolean).join('\n\n'),
      });
    }
  }
  return { schemaVersion: 1, datasetHash: hash(dataset), items };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}

/** Import one explicitly selected human reviewer; never aggregate or import suggestions. */
export function importPotato(
  dataset: Dataset,
  manifest: PotatoManifest,
  jsonl: string,
  reviewer: string,
) {
  validateDataset(dataset);
  if (!reviewer.trim()) throw new Error('Select a human reviewer');
  if (manifest.schemaVersion !== 1 || manifest.datasetHash !== hash(dataset))
    throw new Error('Manifest does not match the original dataset snapshot');
  const items = new Map(manifest.items.map((item) => [item.id, item]));
  if (items.size !== manifest.items.length)
    throw new Error('Duplicate manifest item');
  const pairs = new Set<string>();
  for (const item of items.values()) {
    const entry = dataset.entries.find((e) => e.id === item.entryId);
    const query = dataset.queries.find((q) => q.id === item.queryId);
    const pair = JSON.stringify([item.queryId, item.entryId]);
    if (
      !entry ||
      !query ||
      entry.contentHash !== item.entryHash ||
      query.textHash !== item.queryHash ||
      item.query !== query.text ||
      item.content !==
        [entry.title, entry.content].filter(Boolean).join('\n\n') ||
      item.id !==
        hash([query.id, entry.id, query.textHash, entry.contentHash]) ||
      pairs.has(pair)
    )
      throw new Error('Invalid or stale manifest item');
    pairs.add(pair);
  }
  const imported: Judgment[] = [];
  const engineRequests: Record<string, HumanEngineRequest> = {};
  const seen = new Set<string>();
  let selectedRows = 0;
  for (const line of jsonl.split(/\r?\n/).filter((line) => line.trim())) {
    const row = object(JSON.parse(line));
    if (typeof row.user_id !== 'string')
      throw new Error('Missing annotator ID');
    if (row.user_id !== reviewer) continue;
    const engineRequest = humanEngineRequest(row, 'relevance');
    selectedRows++;
    if (typeof row.instance_id !== 'string' || !items.has(row.instance_id))
      throw new Error('Unknown exported instance');
    if (seen.has(row.instance_id))
      throw new Error('Duplicate reviewer judgment');
    seen.add(row.instance_id);
    if (engineRequest) engineRequests[row.instance_id] = engineRequest;
    const labels = object(row.labels);
    const relevance =
      labels.relevance === undefined ? {} : object(labels.relevance);
    const choices = Object.keys(relevance);
    if (!choices.length) continue;
    const grades = new Map<string, 0 | 1 | 2>([
      ['Answers', 2],
      ['Supports', 1],
      ['Not relevant', 0],
    ]);
    const grade = grades.get(choices[0]);
    if (
      choices.length !== 1 ||
      grade === undefined ||
      relevance[choices[0]] !== choices[0]
    )
      throw new Error('Invalid relevance selection');
    const reason = object(labels.reason).text_box;
    if (typeof reason !== 'string' || !reason.trim())
      throw new Error('Judgment requires a reason');
    const item = items.get(row.instance_id);
    if (!item) throw new Error('Unknown exported instance');
    imported.push({
      queryId: item.queryId,
      entryId: item.entryId,
      queryHash: item.queryHash,
      entryHash: item.entryHash,
      grade,
      reason,
    });
  }
  if (!selectedRows) throw new Error('Reviewer has no exported rows');
  const key = (j: Judgment) => JSON.stringify([j.queryId, j.entryId]);
  const replacements = new Map(imported.map((j) => [key(j), j]));
  const judgments = dataset.judgments.map((j) => {
    const replacement = replacements.get(key(j));
    replacements.delete(key(j));
    return replacement ?? j;
  });
  judgments.push(...replacements.values());
  const changed = hash(judgments) !== hash(dataset.judgments);
  const updated: Dataset = {
    ...dataset,
    labelRevision: dataset.labelRevision + Number(changed),
    judgments,
  };
  validateDataset(updated);
  return {
    dataset: updated,
    receipt: {
      schemaVersion: 1,
      reviewer,
      sourceHash: hash(jsonl),
      manifestHash: hash(manifest),
      originalDatasetHash: hash(dataset),
      updatedDatasetHash: hash(updated),
      selectedRows,
      engineRequests,
      importedJudgments: imported.length,
      changed,
    },
  };
}
