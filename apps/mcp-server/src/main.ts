import './instrumentation.js'; // ← MUST be first: patches http/dns/pino

import { createClient, createRetryFetch } from '@moltnet/api-client';
import {
  createLogger,
  initObservability,
  type ObservabilityContext,
} from '@moltnet/observability';

import pkg from '../package.json' with { type: 'json' };
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { McpDeps } from './types.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Init observability before building the app (sets global OTel providers)
  let observability: ObservabilityContext | undefined;
  if (config.OTLP_ENDPOINT) {
    const authHeaders: Record<string, string> = {
      ...(config.AXIOM_API_TOKEN
        ? { Authorization: `Bearer ${config.AXIOM_API_TOKEN}` }
        : {}),
    };
    const logsDataset = config.AXIOM_LOGS_DATASET ?? config.AXIOM_DATASET;
    const tracesDataset = config.AXIOM_TRACES_DATASET ?? config.AXIOM_DATASET;
    const metricsDataset = config.AXIOM_METRICS_DATASET ?? config.AXIOM_DATASET;
    const logsHeaders: Record<string, string> = {
      ...authHeaders,
      ...(logsDataset ? { 'X-Axiom-Dataset': logsDataset } : {}),
    };
    const tracesHeaders: Record<string, string> = {
      ...authHeaders,
      ...(tracesDataset ? { 'X-Axiom-Dataset': tracesDataset } : {}),
    };
    const metricsHeaders: Record<string, string> = {
      ...authHeaders,
      ...(metricsDataset ? { 'X-Axiom-Dataset': metricsDataset } : {}),
    };
    observability = initObservability({
      serviceName: 'moltnet-mcp-server',
      serviceVersion: pkg.version,
      environment: config.NODE_ENV,
      otlp: {
        endpoint: config.OTLP_ENDPOINT,
        logsHeaders,
        tracesHeaders,
        metricsHeaders,
      },
      logger: {
        level: config.NODE_ENV === 'production' ? 'info' : 'debug',
        pretty: config.NODE_ENV !== 'production',
      },
      tracing: {
        enabled: true,
        ignorePaths: ({ url }) => url.startsWith('/healthz'),
      },
      metrics: { enabled: true, runtimeMetrics: true },
    });
  }

  const client = createClient({
    baseUrl: config.REST_API_URL,
    fetch: createRetryFetch(),
  });

  // buildApp replaces deps.logger with app.log after Fastify is instantiated.
  const deps: McpDeps = {
    client,
    logger: createLogger({ serviceName: 'moltnet-mcp-server' }),
  };

  const app = await buildApp({
    config,
    deps,
    version: pkg.version,
    logger:
      config.NODE_ENV === 'production'
        ? true
        : { transport: { target: 'pino-pretty' } },
    observability,
  });

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.fatal(err, 'Failed to start MCP server');
    process.exit(1);
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Shutting down');
      void app.close().then(() => process.exit(0));
    });
  }
}

void main();
