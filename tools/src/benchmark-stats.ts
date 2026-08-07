export interface BenchmarkDistribution {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/** Nearest-rank percentile over an ascending numeric sample. */
export function nearestRankPercentile(
  sorted: readonly number[],
  quantile: number,
): number {
  if (sorted.length === 0) {
    throw new Error('cannot calculate a percentile for an empty sample');
  }
  if (quantile < 0 || quantile > 1) {
    throw new Error(`quantile must be between 0 and 1, received ${quantile}`);
  }
  const rank = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[rank];
}

export function benchmarkDistribution(
  values: readonly number[],
): BenchmarkDistribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: round(sorted[0]),
    p50: round(nearestRankPercentile(sorted, 0.5)),
    p95: round(nearestRankPercentile(sorted, 0.95)),
    p99: round(nearestRankPercentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
  };
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
