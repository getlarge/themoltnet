import { calculateRetrievalMetrics } from './binary-metrics.js';
import type { Dataset } from './dataset.js';
import { validateDataset } from './dataset.js';
export interface Ranking {
  repeat: number;
  configuration: string;
  queryId: string;
  k: number;
  retrievedIds: string[];
}
export function score(d: Dataset, r: Ranking) {
  validateDataset(d);
  const q = d.queries.find((q) => q.id === r.queryId);
  if (!q) throw new Error('Unknown query');
  // Validate retrieved IDs even when labels are incomplete.
  calculateRetrievalMetrics({
    retrievedIds: r.retrievedIds,
    relevantIds: [],
    corpusIds: d.entries.map((e) => e.id),
    k: r.k,
  });
  const labels = d.judgments.filter((j) => j.queryId === q.id);
  const grades = new Map(labels.map((j) => [j.entryId, j.grade]));
  const returned = r.retrievedIds.slice(0, r.k);
  const unreviewed = returned.filter((id) => !grades.has(id));
  const complete = unreviewed.length === 0,
    corpusComplete = labels.length === d.entries.length;
  const answers = returned.filter((id) => grades.get(id) === 2).length;
  const useful = returned.filter((id) => (grades.get(id) ?? 0) > 0).length;
  return {
    k: r.k,
    reviewed: returned.length - unreviewed.length,
    returned: returned.length,
    unreviewed,
    complete,
    corpusComplete,
    answerPrecision: complete ? answers / r.k : null,
    usefulPrecision: complete ? useful / r.k : null,
    recall:
      corpusComplete && labels.some((j) => j.grade > 0)
        ? useful / labels.filter((j) => j.grade > 0).length
        : null,
    verifiedNoMatch: corpusComplete ? labels.every((j) => j.grade === 0) : null,
    binary:
      d.timePolicy === 'historical-fixture-v1'
        ? calculateRetrievalMetrics({
            retrievedIds: r.retrievedIds,
            relevantIds: labels
              .filter((j) => j.grade > 0)
              .map((j) => j.entryId),
            corpusIds: d.entries.map((e) => e.id),
            k: r.k,
          })
        : null,
  };
}
export function annotationQueue(
  rankings: Ranking[],
  queryId: string,
): string[] {
  return [
    ...new Set(
      rankings
        .filter((r) => r.queryId === queryId)
        .flatMap((r) => r.retrievedIds.slice(0, 10)),
    ),
  ];
}
export function rescore(
  original: Dataset,
  updated: Dataset,
  rankings: Ranking[],
) {
  validateDataset(original);
  validateDataset(updated);
  if (
    JSON.stringify(original.entries) !== JSON.stringify(updated.entries) ||
    JSON.stringify(original.queries) !== JSON.stringify(updated.queries) ||
    original.timePolicy !== updated.timePolicy ||
    original.capturedAt !== updated.capturedAt
  )
    throw new Error('Rankings are incompatible with changed inputs');
  return rankings.map((r) => ({ ...r, metrics: score(updated, r) }));
}
