import { cosineDistance } from './cluster.js';
import type { DistillEntry } from './types.js';

export interface MmrOptions {
  /** Number of entries to return. */
  k: number;
  /** Relevance vs diversity. 0 = pure diversity, 1 = pure relevance. Default 0.5. */
  lambda?: number;
}

export function mmr(
  entries: DistillEntry[],
  queryEmbedding: number[] | undefined,
  options: MmrOptions,
): DistillEntry[] {
  const { k, lambda = 0.5 } = options;
  if (entries.length === 0) return [];

  const limit = Math.min(k, entries.length);
  const selected: DistillEntry[] = [];
  const remaining = [...entries];

  while (selected.length < limit) {
    let bestScore = -Infinity;
    let bestIdx = 0;

    for (let i = 0; i < remaining.length; i++) {
      const e = remaining[i];
      const relevance = queryEmbedding
        ? 1 - cosineDistance(e.embedding, queryEmbedding)
        : e.importance / 10;

      const maxSim =
        selected.length === 0
          ? 0
          : Math.max(
              ...selected.map(
                (s) => 1 - cosineDistance(e.embedding, s.embedding),
              ),
            );

      const score = lambda * relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}
