/**
 * Agglomerative clustering with average linkage and cosine distance.
 *
 * Time: O(n²) — suitable for up to ~500 entries per call.
 * Callers should filter by tags/session to stay within this bound.
 */
import type { DistillEntry } from './types.js';

export interface ClusterOptions {
  /** Cosine distance threshold for merging clusters. Default 0.15. */
  threshold?: number;
}

/** Returns groups of entries; each group is a cluster. */
export function cluster(
  entries: DistillEntry[],
  options: ClusterOptions = {},
): DistillEntry[][] {
  const threshold = options.threshold ?? 0.15;
  if (entries.length === 0) return [];

  // threshold=0 means no merging — distance can never be strictly negative
  if (threshold === 0) return entries.map((e) => [e]);

  // Each entry starts in its own cluster
  const clusters: DistillEntry[][] = entries.map((e) => [e]);

  let merged = true;
  while (merged) {
    merged = false;
    let bestI = -1;
    let bestJ = -1;
    let bestDist = Infinity;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const dist = averageLinkageDistance(clusters[i], clusters[j]);
        if (dist < bestDist) {
          bestDist = dist;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestDist <= threshold) {
      clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
      clusters.splice(bestJ, 1);
      merged = true;
    }
  }

  return clusters;
}

/** Average pairwise cosine distance between two clusters. */
function averageLinkageDistance(a: DistillEntry[], b: DistillEntry[]): number {
  let total = 0;
  for (const ea of a) {
    for (const eb of b) {
      total += cosineDistance(ea.embedding, eb.embedding);
    }
  }
  return total / (a.length * b.length);
}

/** Cosine distance = 1 - cosine_similarity. Range [0, 2] but practically [0, 1] for L2-normalized vectors. */
export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}
