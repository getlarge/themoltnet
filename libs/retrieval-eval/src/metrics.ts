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
    JSON.stringify(original.entries.map((e) => [e.id, e.contentHash])) !==
      JSON.stringify(updated.entries.map((e) => [e.id, e.contentHash])) ||
    JSON.stringify(
      original.queries.map((q) => [q.id, q.textHash, q.family, q.split]),
    ) !==
      JSON.stringify(
        updated.queries.map((q) => [q.id, q.textHash, q.family, q.split]),
      ) ||
    original.timePolicy !== updated.timePolicy ||
    original.capturedAt !== updated.capturedAt
  )
    throw new Error('Rankings are incompatible with changed inputs');
  return rankings.map((r) => ({ ...r, metrics: score(updated, r) }));
}

/** Original fixture summaries; repeated trials remain diagnostic repetitions. */
export function summarizeBinary(dataset: Dataset, rankings: Ranking[]) {
  if (dataset.timePolicy !== 'historical-fixture-v1') return [];
  const groups = new Map<string, Ranking[]>();
  for (const r of rankings) {
    const key = JSON.stringify([r.configuration, r.k]);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((group) => {
    const metrics = group
      .map((r) => score(dataset, r).binary)
      .filter((m) => m !== null);
    const answerable = metrics.filter((m) => m.recallAtK !== null),
      noMatch = metrics.filter((m) => m.recallAtK === null);
    return {
      configuration: group[0].configuration,
      k: group[0].k,
      answerableTrials: answerable.length,
      meanPrecisionAtK: answerable.length
        ? answerable.reduce((sum, m) => sum + m.precisionAtK, 0) /
          answerable.length
        : null,
      meanRecallAtK: answerable.length
        ? answerable.reduce((sum, m) => sum + (m.recallAtK ?? 0), 0) /
          answerable.length
        : null,
      noMatchMeanFalsePositives: noMatch.length
        ? noMatch.reduce((sum, m) => sum + m.falsePositives, 0) / noMatch.length
        : null,
      noMatchEmptyResultRate: noMatch.length
        ? noMatch.filter((m) => m.retrievedCount === 0).length / noMatch.length
        : null,
    };
  });
}
