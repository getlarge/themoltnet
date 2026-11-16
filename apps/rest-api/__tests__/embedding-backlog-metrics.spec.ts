import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const { meter } = vi.hoisted(() => ({
  meter: {
    createObservableGauge: vi.fn((name: string) => ({ name })),
    addBatchObservableCallback:
      vi.fn<
        (
          callback: (result: {
            observe: (...args: unknown[]) => void;
          }) => Promise<void>,
          instruments: unknown[],
        ) => void
      >(),
    removeBatchObservableCallback: vi.fn(),
  },
}));
vi.mock('@moltnet/observability', () => ({ getMetricMeter: () => meter }));

import { registerEmbeddingBacklogMetrics } from '../src/services/embedding-backlog-metrics.js';

describe('embedding backlog observations', () => {
  it('uses one snapshot, marks failures invalid, and unregisters on close', async () => {
    const app = Fastify({ logger: false });
    const snapshot = vi
      .fn()
      .mockResolvedValue({ pending: 4, oldestAgeSeconds: 30 });
    registerEmbeddingBacklogMetrics(app, snapshot);
    await app.ready();
    const [observe, instruments] =
      meter.addBatchObservableCallback.mock.calls[0];
    const result = { observe: vi.fn() };
    await observe(result);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(
      result.observe.mock.calls.map(([gauge, value]) => [gauge, value]),
    ).toEqual([
      [{ name: 'diary.embedding.backlog' }, 4],
      [{ name: 'diary.embedding.oldest_pending_age' }, 30],
      [{ name: 'diary.embedding.observation.success' }, 1],
    ]);
    snapshot.mockRejectedValue(new Error('synthetic query failure'));
    result.observe.mockClear();
    await observe(result);
    expect(result.observe).toHaveBeenCalledExactlyOnceWith(
      { name: 'diary.embedding.observation.success' },
      0,
      { queue: 'diary-embeddings' },
    );
    await app.close();
    expect(meter.removeBatchObservableCallback).toHaveBeenCalledWith(
      observe,
      instruments,
    );
  });
});
