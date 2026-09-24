import { describe, expect, it, vi } from 'vitest';

const instruments = vi.hoisted(() => {
  const counters = new Map<string, ReturnType<typeof vi.fn>>();
  return { counters };
});

vi.mock('@moltnet/observability', () => ({
  createMetricCounter: vi.fn((_meter: string, name: string) => {
    const add = vi.fn();
    instruments.counters.set(name, add);
    return { add };
  }),
  createMetricHistogram: vi.fn(() => ({ record: vi.fn() })),
}));

import { createTokenExchangeMetrics } from '../src/metrics.js';

describe('token-cache metric instruments', () => {
  it('emits operation and write-gate state used by the auth monitors', () => {
    // Arrange
    const metrics = createTokenExchangeMetrics();

    // Act
    metrics.recordCacheError('rest-proxy', 'scan');
    metrics.recordCacheError('rest-proxy', 'probe');
    metrics.recordWriteGateChange('rest-proxy', true);
    metrics.recordUnavailable('rest-proxy', 'client_credentials');

    // Assert
    expect(
      instruments.counters.get('auth.token.cache.errors'),
    ).toHaveBeenCalledWith(1, { source: 'rest-proxy', operation: 'scan' });
    expect(
      instruments.counters.get('auth.token.cache.errors'),
    ).toHaveBeenCalledWith(1, { source: 'rest-proxy', operation: 'probe' });
    expect(
      instruments.counters.get('auth.token.cache.write_gate_changes'),
    ).toHaveBeenCalledWith(1, { source: 'rest-proxy', state: 'blocked' });
    expect(
      instruments.counters.get('auth.token.unavailable'),
    ).toHaveBeenCalledWith(1, {
      source: 'rest-proxy',
      grant_type: 'client_credentials',
    });
  });
});
