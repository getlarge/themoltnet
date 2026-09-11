/**
 * OTel SDK bootstrap for the agent daemon.
 *
 *   const shutdown = await initWorkerOtel({ serviceName, agent });
 *   try { ... } finally { await shutdown(); }
 *
 * No-op when MOLTNET_OTEL_ENDPOINT is unset — `@opentelemetry/api` falls
 * back to no-op tracers and meters, so the runtime + pi extension still
 * call into it but nothing is exported.
 */
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { Agent } from '@themoltnet/sdk';

export interface InitWorkerOtelOptions {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  /**
   * Already-authenticated host agent. Daemon callers pass this so telemetry
   * authentication cannot independently re-resolve ambient credentials.
   */
  agent?: Pick<Agent, 'getToken'>;
  /**
   * OTLP endpoint base URL. Empty/undefined → bootstrap is a no-op.
   * Callers usually source this from `loadConfig()` so env reads stay in
   * one place; the option remains explicit so tests can pass values
   * without touching process.env.
   */
  endpoint?: string;
  resourceAttributes?: Record<string, string>;
}

export type OtelShutdown = () => Promise<void>;

export function initWorkerOtel(
  options: InitWorkerOtelOptions,
): Promise<OtelShutdown> {
  const endpoint = options.endpoint;
  if (!endpoint) {
    return Promise.resolve(async () => {});
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.serviceName,
    ...(options.serviceVersion && {
      [ATTR_SERVICE_VERSION]: options.serviceVersion,
    }),
    ...(options.environment && {
      'deployment.environment': options.environment,
    }),
    ...options.resourceAttributes,
  });

  // Async headers factory — exporter calls it before each batch, so the
  // bearer token is always fresh. TokenManager inside connect() handles
  // caching + refresh.
  let headersFactory: (() => Promise<Record<string, string>>) | undefined;
  const agent = options.agent;
  if (agent) {
    headersFactory = async () => {
      const token = await agent.getToken();
      return { Authorization: `Bearer ${token}` };
    };
  }

  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    ...(headersFactory && { headers: headersFactory }),
  });
  const metricExporter = new OTLPMetricExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/metrics`,
    ...(headersFactory && { headers: headersFactory }),
  });

  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });

  // register() installs the context manager + propagator too — required
  // for parent/child span linkage across await boundaries.
  // setGlobalTracerProvider() alone is NOT enough.
  provider.register();
  metrics.setGlobalMeterProvider(meterProvider);

  return Promise.resolve(async () => {
    await Promise.all([
      provider.forceFlush().catch((err) => {
        process.stderr.write(
          `[otel-bootstrap] trace forceFlush failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }),
      meterProvider.forceFlush().catch((err) => {
        process.stderr.write(
          `[otel-bootstrap] metric forceFlush failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }),
    ]);
    await Promise.all([
      provider.shutdown().catch((err) => {
        process.stderr.write(
          `[otel-bootstrap] trace shutdown failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }),
      meterProvider.shutdown().catch((err) => {
        process.stderr.write(
          `[otel-bootstrap] metric shutdown failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }),
    ]);
  });
}
