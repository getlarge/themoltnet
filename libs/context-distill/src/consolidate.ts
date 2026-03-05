import { cluster } from './cluster.js';
import { select, type SelectionStrategy } from './selector.js';
import type { ConsolidateResult, DistillEntry } from './types.js';

export interface ConsolidateOptions {
  threshold?: number;
  strategy?: SelectionStrategy;
}

export function consolidate(
  entries: DistillEntry[],
  options: ConsolidateOptions = {},
): ConsolidateResult {
  const start = performance.now();
  const threshold = options.threshold ?? 0.15;
  const strategy = options.strategy ?? 'hybrid';

  if (entries.length === 0) {
    return {
      clusters: [],
      stats: {
        inputCount: 0,
        clusterCount: 0,
        singletonRate: 0,
        clusterSizeDistribution: [0, 0, 0, 0, 0],
        elapsedMs: performance.now() - start,
      },
      trace: {
        thresholdUsed: threshold,
        strategyUsed: strategy,
        embeddingDim: 0,
      },
    };
  }

  const groups = cluster(entries, { threshold });
  const clusters = groups.map((members) => select(members, strategy));

  const sizes = clusters.map((c) => c.members.length).sort((a, b) => a - b);
  const singletonRate = sizes.filter((s) => s === 1).length / clusters.length;
  const embeddingDim = entries[0].embedding.length;

  return {
    clusters,
    stats: {
      inputCount: entries.length,
      clusterCount: clusters.length,
      singletonRate,
      clusterSizeDistribution: percentiles(sizes),
      elapsedMs: performance.now() - start,
    },
    trace: {
      thresholdUsed: threshold,
      strategyUsed: strategy,
      embeddingDim,
    },
  };
}

function percentiles(
  sorted: number[],
): [number, number, number, number, number] {
  if (sorted.length === 0) return [0, 0, 0, 0, 0];
  const p = (pct: number) =>
    sorted[Math.floor((pct / 100) * (sorted.length - 1))];
  return [sorted[0], p(25), p(50), p(75), sorted[sorted.length - 1]];
}
