import type { DiaryEmbeddingBacklog } from '@moltnet/database';
import { getMetricMeter } from '@moltnet/observability';
import type { FastifyInstance } from 'fastify';

export function registerEmbeddingBacklogMetrics(
  app: FastifyInstance,
  snapshot: () => Promise<DiaryEmbeddingBacklog>,
): void {
  const attributes = { queue: 'diary-embeddings' };
  const meter = getMetricMeter('moltnet-rest-api');
  const pending = meter.createObservableGauge('diary.embedding.backlog', {
    description:
      'Global outstanding diary embedding chains (aggregate instances with max)',
  });
  const age = meter.createObservableGauge(
    'diary.embedding.oldest_pending_age',
    {
      description:
        'Age of the oldest outstanding chain, including delayed retries',
      unit: 's',
    },
  );
  const success = meter.createObservableGauge(
    'diary.embedding.observation.success',
    {
      description:
        'Whether this instance successfully observed the queue in this collection',
    },
  );
  const gauges = [pending, age, success];
  const observe: Parameters<
    typeof meter.addBatchObservableCallback
  >[0] = async (result) => {
    try {
      const current = await snapshot();
      result.observe(pending, current.pending, attributes);
      result.observe(age, current.oldestAgeSeconds, attributes);
      result.observe(success, 1, attributes);
    } catch (err) {
      // The SDK retains last-known samples when a gauge isn't observed.
      result.observe(success, 0, attributes);
      app.log.warn({ err }, 'diary.embedding.backlog_observation_failed');
    }
  };
  meter.addBatchObservableCallback(observe, gauges);
  app.addHook('onClose', () => {
    meter.removeBatchObservableCallback(observe, gauges);
    return Promise.resolve();
  });
}
