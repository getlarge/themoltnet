import { describe, expect, it } from 'vitest';

import {
  evaluateBenchmarkGate,
  isLoopbackEndpoint,
} from './keto-claim-benchmark.js';

describe('Keto claim benchmark safeguards', () => {
  it('accepts loopback endpoints and refuses remote hosts', () => {
    expect(isLoopbackEndpoint('http://127.0.0.1:4466')).toBe(true);
    expect(isLoopbackEndpoint('http://[::1]:4466')).toBe(true);
    expect(isLoopbackEndpoint('https://keto.example.com')).toBe(false);
  });

  it('requires both a 10 percent and 1ms p95 regression', () => {
    expect(
      evaluateBenchmarkGate({
        baselineP95: [5, 5, 5],
        candidateP95: [6, 6, 6],
        baselineThroughput32: [100, 100, 100],
        candidateThroughput32: [100, 100, 100],
      }).passed,
    ).toBe(true);
    expect(
      evaluateBenchmarkGate({
        baselineP95: [5, 5, 5],
        candidateP95: [6.1, 6.1, 6.1],
        baselineThroughput32: [100, 100, 100],
        candidateThroughput32: [100, 100, 100],
      }).passed,
    ).toBe(false);
  });

  it('fails a concurrency-32 throughput regression over 10 percent', () => {
    const result = evaluateBenchmarkGate({
      baselineP95: [5],
      candidateP95: [5],
      baselineThroughput32: [100],
      candidateThroughput32: [89],
    });
    expect(result.throughputRegression).toBe(true);
    expect(result.passed).toBe(false);
  });
});
