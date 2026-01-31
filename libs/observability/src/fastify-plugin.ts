import { metrics as metricsApi } from '@opentelemetry/api';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import type { RequestMetrics } from './types.js';

export interface ObservabilityPluginOptions {
  /** Service name used as meter scope */
  serviceName: string;
  /** Pre-created request metrics (optional - created internally if not provided) */
  metrics?: RequestMetrics;
  /** Shutdown function called on app close (e.g. from initObservability) */
  shutdown?: () => Promise<void>;
}

declare module 'fastify' {
  interface FastifyRequest {
    startTime: bigint;
  }
}

const plugin: FastifyPluginAsync<ObservabilityPluginOptions> = async (
  app: FastifyInstance,
  options: ObservabilityPluginOptions,
) => {
  const { serviceName, shutdown } = options;

  // Create or use provided request metrics
  const meter = metricsApi.getMeter(serviceName);

  const requestMetrics: RequestMetrics = options.metrics ?? {
    duration: meter.createHistogram('http.server.request.duration', {
      description: 'Duration of inbound HTTP requests in milliseconds',
      unit: 'ms',
    }),
    total: meter.createCounter('http.server.request.total', {
      description: 'Total number of inbound HTTP requests',
    }),
    active: meter.createUpDownCounter('http.server.active_requests', {
      description: 'Number of currently active inbound HTTP requests',
    }),
  };

  // Track request start time and active count
  app.addHook('onRequest', (request, _reply, done) => {
    request.startTime = process.hrtime.bigint();
    requestMetrics.active.add(1);
    done();
  });

  // Record metrics on response
  app.addHook('onResponse', (request, reply, done) => {
    requestMetrics.active.add(-1);

    const durationMs =
      Number(process.hrtime.bigint() - request.startTime) / 1_000_000;

    const attributes = {
      'http.method': request.method,
      'http.route': request.routeOptions?.url ?? request.url,
      'http.status_code': reply.statusCode,
    };

    requestMetrics.duration.record(durationMs, attributes);
    requestMetrics.total.add(1, attributes);

    done();
  });

  // Graceful shutdown of telemetry pipelines
  if (shutdown) {
    app.addHook('onClose', async () => {
      await shutdown();
    });
  }
};

export const observabilityPlugin = fp(plugin, {
  name: '@moltnet/observability',
  fastify: '>=4.0.0',
});
