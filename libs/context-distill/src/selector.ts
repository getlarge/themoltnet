import { cosineDistance } from './cluster.js';
import type { Cluster, DistillEntry } from './types.js';

export type SelectionStrategy = 'score' | 'centroid' | 'hybrid';

export function select(
  members: DistillEntry[],
  strategy: SelectionStrategy,
): Cluster {
  const representative = pickRepresentative(members, strategy);
  const similarity = averageIntraClusterSimilarity(members);
  const confidence = Math.max(0, Math.min(1, similarity));

  return {
    representative,
    representativeReason: strategyReason(strategy),
    members,
    similarity,
    confidence,
    suggestedAction: suggestAction(similarity, members.length),
  };
}

function pickRepresentative(
  members: DistillEntry[],
  strategy: SelectionStrategy,
): DistillEntry {
  if (members.length === 1) return members[0];

  if (strategy === 'score') {
    return members.reduce((best, e) =>
      e.importance > best.importance ? e : best,
    );
  }

  if (strategy === 'centroid') {
    const centroid = computeCentroid(members);
    return members.reduce((best, e) =>
      cosineDistance(e.embedding, centroid) <
      cosineDistance(best.embedding, centroid)
        ? e
        : best,
    );
  }

  // hybrid: average of normalized importance and centroid proximity
  const centroid = computeCentroid(members);
  const maxImportance = Math.max(...members.map((e) => e.importance));
  return members.reduce((best, e) => {
    const impScore = e.importance / (maxImportance || 1);
    const proxScore = 1 - cosineDistance(e.embedding, centroid);
    const score = (impScore + proxScore) / 2;

    const bestImpScore = best.importance / (maxImportance || 1);
    const bestProxScore = 1 - cosineDistance(best.embedding, centroid);
    const bestScore = (bestImpScore + bestProxScore) / 2;

    return score > bestScore ? e : best;
  });
}

function computeCentroid(members: DistillEntry[]): number[] {
  const dim = members[0].embedding.length;
  const centroid = new Array<number>(dim).fill(0);
  for (const e of members) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += e.embedding[i];
    }
  }
  return centroid.map((v) => v / members.length);
}

function averageIntraClusterSimilarity(members: DistillEntry[]): number {
  if (members.length === 1) return 1;
  let total = 0;
  let count = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      total += 1 - cosineDistance(members[i].embedding, members[j].embedding);
      count++;
    }
  }
  return total / count;
}

function suggestAction(
  similarity: number,
  size: number,
): Cluster['suggestedAction'] {
  if (size === 1) return 'keep_separate';
  if (similarity >= 0.9) return 'merge';
  if (similarity >= 0.7) return 'review';
  return 'keep_separate';
}

function strategyReason(strategy: SelectionStrategy): string {
  switch (strategy) {
    case 'score':
      return 'highest_score';
    case 'centroid':
      return 'closest_to_centroid';
    case 'hybrid':
      return 'hybrid_score';
  }
}
