import { benchmarkDistribution } from './benchmark-stats.js';

export interface BenchmarkGateInput {
  baselineP95: number[];
  candidateP95: number[];
  baselineThroughput32: number[];
  candidateThroughput32: number[];
}

export function isLoopbackEndpoint(value: string): boolean {
  const host = new URL(value).hostname.replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function median(values: readonly number[]): number {
  const distribution = benchmarkDistribution(values);
  if (!distribution) throw new Error('cannot calculate median of no values');
  return distribution.p50;
}

export function evaluateBenchmarkGate(input: BenchmarkGateInput) {
  const baselineP95 = median(input.baselineP95);
  const candidateP95 = median(input.candidateP95);
  const baselineThroughput32 = median(input.baselineThroughput32);
  const candidateThroughput32 = median(input.candidateThroughput32);
  const p95Regression =
    candidateP95 - baselineP95 > 1 && candidateP95 > baselineP95 * 1.1;
  const throughputRegression =
    candidateThroughput32 < baselineThroughput32 * 0.9;
  return {
    passed: !p95Regression && !throughputRegression,
    p95Regression,
    throughputRegression,
    medianP95: { baseline: baselineP95, candidate: candidateP95 },
    medianThroughput32: {
      baseline: baselineThroughput32,
      candidate: candidateThroughput32,
    },
  };
}
