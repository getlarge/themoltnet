import { FastifyOtelInstrumentation } from '@fastify/otel';
import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  metrics as metricsApi,
} from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import type { MeterProvider } from '@opentelemetry/sdk-metrics';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import type { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

import type { LogRecordProcessorOptions } from './logger.js';
import { createLogger } from './logger.js';
import { createMeterProvider } from './metrics.js';
import { createTraceProvider } from './tracing.js';
import type {
  AxiomOtlpConfigInput,
  ObservabilityConfig,
  ObservabilityContext,
  OtlpConfig,
} from './types.js';

export function resolveOtlpSignalHeaders(otlp: ObservabilityConfig['otlp']): {
  logsHeaders?: Record<string, string>;
  tracesHeaders?: Record<string, string>;
  metricsHeaders?: Record<string, string>;
} {
  return {
    logsHeaders: otlp?.logsHeaders ?? otlp?.headers,
    tracesHeaders: otlp?.tracesHeaders ?? otlp?.headers,
    metricsHeaders: otlp?.metricsHeaders ?? otlp?.headers,
  };
}

export function createAxiomOtlpConfig(input: AxiomOtlpConfigInput): OtlpConfig {
  const authHeaders: Record<string, string> = {
    ...(input.apiToken ? { Authorization: `Bearer ${input.apiToken}` } : {}),
  };
  const logsDataset = input.logsDataset ?? input.dataset;
  const tracesDataset = input.tracesDataset ?? input.dataset;
  const metricsDataset = input.metricsDataset ?? input.dataset;

  return {
    endpoint: input.endpoint,
    logsHeaders: {
      ...authHeaders,
      ...(logsDataset ? { 'X-Axiom-Dataset': logsDataset } : {}),
    },
    tracesHeaders: {
      ...authHeaders,
      ...(tracesDataset ? { 'X-Axiom-Dataset': tracesDataset } : {}),
    },
    metricsHeaders: {
      ...authHeaders,
      ...(metricsDataset ? { 'X-Axiom-Dataset': metricsDataset } : {}),
    },
  };
}

/**
 * Initialize the full observability stack.
 *
 * Sets up:
 * 1. Pino logger with structured base bindings + pino-opentelemetry-transport
 *    (two worker threads: stdout and OTLP log export)
 * 2. OpenTelemetry tracing with @fastify/otel for lifecycle-hook instrumentation
 * 3. OpenTelemetry metrics with OTLP export
 * 4. Graceful shutdown
 *
 * Usage:
 * ```ts
 * const obs = initObservability({
 *   serviceName: 'moltnet-api',
 *   serviceVersion: '0.1.0',
 *   environment: 'production',
 *   otlp: { endpoint: 'https://api.axiom.co', headers: { Authorization: 'Bearer ...' } },
 *   tracing: { enabled: true },
 *   metrics: { enabled: true },
 * });
 *
 * const app = Fastify({ loggerInstance: obs.logger });
 *
 * // Register @fastify/otel BEFORE routes for full lifecycle tracing
 * if (obs.fastifyOtelPlugin) {
 *   await app.register(obs.fastifyOtelPlugin);
 * }
 *
 * // Register metrics plugin for request duration/count/active
 * await app.register(observabilityPlugin, {
 *   serviceName: 'moltnet-api',
 *   shutdown: obs.shutdown,
 * });
 * ```
 */
export function initObservability(
  config: ObservabilityConfig,
): ObservabilityContext {
  // Enable OTel diagnostic logging so export failures are visible in stdout
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  const {
    serviceName,
    serviceVersion,
    environment,
    otlp,
    logger: loggerConfig,
    tracing: tracingConfig,
    metrics: metricsConfig,
  } = config;

  let tracerProvider: NodeTracerProvider | undefined;
  let meterProvider: MeterProvider | undefined;
  let fastifyInstrumentation: FastifyOtelInstrumentation | undefined;
  let hasShutdown = false;
  const { logsHeaders, tracesHeaders, metricsHeaders } =
    resolveOtlpSignalHeaders(otlp);

  // Initialize tracing if enabled
  if (tracingConfig?.enabled) {
    tracerProvider = createTraceProvider({
      serviceName,
      serviceVersion,
      environment,
      exporter: otlp
        ? new OTLPTraceExporter({
            url: `${otlp.endpoint}/v1/traces`,
            headers: tracesHeaders,
          })
        : undefined,
    });

    tracerProvider.register();

    // Create @fastify/otel instrumentation for lifecycle-hook tracing
    fastifyInstrumentation = new FastifyOtelInstrumentation({
      ignorePaths: tracingConfig.ignorePaths,
    });
    fastifyInstrumentation.setTracerProvider(tracerProvider);
  }

  // Initialize metrics if enabled
  if (metricsConfig?.enabled) {
    const reader = otlp
      ? new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `${otlp.endpoint}/v1/metrics`,
            headers: metricsHeaders,
          }),
          exportIntervalMillis: metricsConfig.exportIntervalMs ?? 60_000,
        })
      : undefined;

    meterProvider = createMeterProvider({
      serviceName,
      serviceVersion,
      environment,
      reader,
    });

    metricsApi.setGlobalMeterProvider(meterProvider);

    if (metricsConfig.runtimeMetrics) {
      const runtimeInstrumentation = new RuntimeNodeInstrumentation();
      runtimeInstrumentation.setMeterProvider(meterProvider);
      runtimeInstrumentation.enable();
    }
  }

  // Build logRecordProcessorOptions for pino-opentelemetry-transport.
  // The transport runs in a worker thread and manages its own OTLP log exporter.
  // Without this, logs are emitted into the transport but never exported.
  const otelEnabled =
    Boolean(tracingConfig?.enabled || metricsConfig?.enabled) && Boolean(otlp);

  let logRecordProcessorOptions: LogRecordProcessorOptions[] | undefined;
  if (otelEnabled && otlp) {
    logRecordProcessorOptions = [
      {
        recordProcessorType: 'batch',
        exporterOptions: {
          protocol: 'http/protobuf',
          protobufExporterOptions: {
            url: `${otlp.endpoint}/v1/logs`,
            headers: logsHeaders ?? {},
          },
        },
      },
    ];
  }

  const logger = createLogger({
    serviceName,
    serviceVersion,
    environment,
    level: loggerConfig?.level,
    pretty: loggerConfig?.pretty,
    otelEnabled,
    logRecordProcessorOptions,
  });

  const shutdown = async (): Promise<void> => {
    if (hasShutdown) return;
    hasShutdown = true;

    const shutdownPromises: Promise<void>[] = [];

    if (tracerProvider) {
      shutdownPromises.push(
        tracerProvider.shutdown().catch((err) => {
          logger.warn({ err }, 'Error shutting down tracer provider');
        }),
      );
    }

    if (meterProvider) {
      shutdownPromises.push(
        meterProvider.shutdown().catch((err) => {
          logger.warn({ err }, 'Error shutting down meter provider');
        }),
      );
    }

    await Promise.all(shutdownPromises);
  };

  return {
    logger,
    shutdown,
    fastifyOtelPlugin: fastifyInstrumentation?.plugin(),
  };
}
