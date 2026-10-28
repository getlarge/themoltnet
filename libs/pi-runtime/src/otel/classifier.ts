import type { Models } from '@earendil-works/pi-ai';
import { AI_TELEMETRY_SCHEMA } from '@earendil-works/pi-ai/models';
import { createTypedMetrics } from '@earendil-works/pi-telemetry';

import { createPiTelemetry } from './durable.js';

/** Pi 1.4 observes streaming requests only. Keep one-shot classification visible too. */
export function withClassifierTelemetry(
  classify: Models['classify'],
): Models['classify'] {
  return async (model, input, options) => {
    const telemetry = options?.telemetry ?? createPiTelemetry();
    const attrs = { provider: model.provider, model: model.id };
    const started = performance.now();
    return telemetry.startSpan(
      {
        name: 'pi.ai.request',
        attributes: { ...attrs, api: model.api, operation: 'classify' },
      },
      async (span) => {
        const result = await classify(model, input, {
          ...options,
          telemetry: span,
        });
        span.setAttributes({ stop: result.stopReason });
        if (result.stopReason === 'error')
          span.setStatus({
            status: 'error',
            error: { name: 'provider_error', message: '' },
          });
        const metrics = span.metrics
          ? createTypedMetrics(span.metrics, [AI_TELEMETRY_SCHEMA])
          : undefined;
        metrics
          ?.histogram('pi.ai.request.duration')
          .record(
            performance.now() - started,
            { ...attrs, stop: result.stopReason },
            span,
          );
        const usage = result.usage;
        if (usage) {
          span.setAttributes({
            'usage.input': usage.input,
            'usage.output': usage.output,
            'usage.cache_read': usage.cacheRead,
            'usage.cache_write': usage.cacheWrite,
            'cost.total': usage.cost.total,
          });
          const tokens = metrics?.counter('pi.ai.tokens');
          for (const [kind, count] of [
            ['input', usage.input],
            ['output', usage.output],
            ['cache_read', usage.cacheRead],
            ['cache_write', usage.cacheWrite],
          ] as const)
            tokens?.add(count, { ...attrs, kind });
          metrics?.counter('pi.ai.cost').add(usage.cost.total, attrs);
        }
        return result;
      },
    );
  };
}
