import { describe, expect, it } from 'vitest';

import { HTTP_REQUEST_DURATION_BOUNDARIES_MS } from '../src/metrics.js';

// Models the linear in-bucket interpolation behind Axiom's
// `interpolate_cumulative_histogram(rate, 0.95)`, which drives the REST latency
// monitor (infra/axiom/monitors/request-latency-p95.json, threshold 3000 ms).
const OTEL_DEFAULT_BOUNDARIES = [
  0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000,
];
const THRESHOLD_MS = 3000;

function interpolatedQuantile(
  boundaries: number[],
  samples: number[],
  q: number,
) {
  // OTel buckets are (previous, boundary]; the last one is unbounded.
  const counts = new Array<number>(boundaries.length + 1).fill(0);
  for (const sample of samples) {
    const index = boundaries.findIndex((boundary) => sample <= boundary);
    counts[index === -1 ? boundaries.length : index]++;
  }
  const rank = q * samples.length;
  let below = 0;
  for (const [index, count] of counts.entries()) {
    if (below + count >= rank && count > 0) {
      if (index === boundaries.length) return boundaries.at(-1)!;
      const lower = index === 0 ? 0 : boundaries[index - 1];
      return lower + ((rank - below) / count) * (boundaries[index] - lower);
    }
    below += count;
  }
  return Number.NaN;
}

describe('REST latency alert bucket resolution', () => {
  it('reproduces the 4875 ms false alert with the OTel default buckets', () => {
    // 2026-10-13 07:40 window: one 2752.29 ms conversation list request.
    expect(interpolatedQuantile(OTEL_DEFAULT_BOUNDARIES, [2752.29], 0.95)).toBe(
      4875,
    );
  });

  it.each([[[2752.29]], [[474.85, 2752.29, 2193.24]], [[2999, 2999, 120]]])(
    'stays below the threshold when no request exceeded it: %j',
    (samples) => {
      expect(
        interpolatedQuantile(
          HTTP_REQUEST_DURATION_BOUNDARIES_MS,
          samples,
          0.95,
        ),
      ).toBeLessThan(THRESHOLD_MS);
    },
  );

  it.each([[[3001]], [[3200, 150, 140]], [[12_000]], [[45_000]]])(
    'still alerts on sparse traffic when a request exceeded it: %j',
    (samples) => {
      expect(
        interpolatedQuantile(
          HTTP_REQUEST_DURATION_BOUNDARIES_MS,
          samples,
          0.95,
        ),
      ).toBeGreaterThanOrEqual(THRESHOLD_MS);
    },
  );

  it('keeps the threshold on a bucket boundary', () => {
    expect(HTTP_REQUEST_DURATION_BOUNDARIES_MS).toContain(THRESHOLD_MS);
  });
});
