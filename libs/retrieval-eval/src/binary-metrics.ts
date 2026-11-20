/**
 * Deterministic, binary relevance metrics for a fully labeled corpus.
 * No search, database or model calls occur here.
 */
export interface RetrievalMetricInput {
  readonly retrievedIds: readonly string[];
  readonly relevantIds: readonly string[];
  readonly corpusIds: readonly string[];
  readonly k: number;
}

export interface RetrievalMetrics {
  readonly k: number;
  readonly retrievedCount: number;
  readonly relevantCount: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly precisionAtK: number;
  /** Null when the query has no relevant entries; exclude from mean recall. */
  readonly recallAtK: number | null;
  readonly unexpectedIds: readonly string[];
  readonly missedRelevantIds: readonly string[];
}

function uniqueIds(ids: readonly string[], name: string): Set<string> {
  const unique = new Set(ids);
  if (ids.some((id) => id.trim().length === 0) || unique.size !== ids.length) {
    throw new Error(`${name} must contain distinct, nonempty IDs`);
  }
  return unique;
}

/**
 * Uses the first k returned entries, preserving their order.
 * Precision@k = relevant hits / k, even if fewer than k entries were returned.
 * Recall@k = relevant hits / all relevant entries in this corpus.
 * False positives count returned, nonrelevant entries only, not unfilled slots.
 * Empty results yield precision 0 and recall 0 (or null for no-match queries).
 * Duplicate or unknown IDs are rejected rather than silently inflating scores.
 */
export function calculateRetrievalMetrics({
  retrievedIds,
  relevantIds,
  corpusIds,
  k,
}: RetrievalMetricInput): RetrievalMetrics {
  if (!Number.isSafeInteger(k) || k < 1) {
    throw new Error('k must be a positive safe integer');
  }

  const corpus = uniqueIds(corpusIds, 'corpusIds');
  const relevant = uniqueIds(relevantIds, 'relevantIds');
  uniqueIds(retrievedIds, 'retrievedIds');

  for (const id of [...relevantIds, ...retrievedIds]) {
    if (!corpus.has(id)) {
      throw new Error(`Unknown corpus ID: ${id}`);
    }
  }

  const topIds = retrievedIds.slice(0, k);
  const topSet = new Set(topIds);
  const unexpectedIds = topIds.filter((id) => !relevant.has(id));
  const truePositives = topIds.length - unexpectedIds.length;

  return {
    k,
    retrievedCount: topIds.length,
    relevantCount: relevant.size,
    truePositives,
    falsePositives: unexpectedIds.length,
    precisionAtK: truePositives / k,
    recallAtK: relevant.size === 0 ? null : truePositives / relevant.size,
    unexpectedIds,
    missedRelevantIds: relevantIds.filter((id) => !topSet.has(id)),
  };
}
