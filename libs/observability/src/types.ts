import type { Counter, Histogram, UpDownCounter } from '@opentelemetry/api';
import type { FastifyPluginCallback } from 'fastify';
import type { Logger } from 'pino';

export interface OtlpConfig {
  /**
   * OTLP HTTP base endpoint URL.
   * Traces are sent to `${endpoint}/v1/traces`, metrics to `${endpoint}/v1/metrics`.
   * For Axiom: 'https://api.axiom.co'
   * For local Collector: 'http://localhost:4318'
   */
  endpoint: string;
  /**
   * Legacy/common headers for all signal exporters.
   * Signal-specific headers below take precedence when provided.
   */
  headers?: Record<string, string>;
  /** Headers override for the trace exporter. */
  tracesHeaders?: Record<string, string>;
  /** Headers override for the log exporter. */
  logsHeaders?: Record<string, string>;
  /**
   * Headers override for the metrics exporter.
   * When set, the metrics exporter uses these headers instead of `headers`.
   * Use when signals go to different Axiom datasets.
   */
  metricsHeaders?: Record<string, string>;
}

export interface AxiomOtlpConfigInput {
  endpoint: string;
  apiToken?: string;
  /** Legacy/common Axiom dataset fallback for logs, traces, and metrics */
  dataset?: string;
  /** Axiom dataset for logs (falls back to dataset) */
  logsDataset?: string;
  /** Axiom dataset for traces (falls back to dataset) */
  tracesDataset?: string;
  /** Axiom dataset for metrics (falls back to dataset) */
  metricsDataset?: string;
}

export interface LoggerConfig {
  /** Pino log level */
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  /** Enable pretty printing (development only) */
  pretty?: boolean;
}

export interface TracingConfig {
  /** Enable distributed tracing */
  enabled?: boolean;
  /**
   * Paths to ignore from @fastify/otel tracing.
   * Can be a glob string (e.g. '/healthcheck') or a function
   * receiving request options and returning true to skip.
   */
  ignorePaths?: string | ((opts: { url: string; method: string }) => boolean);
}

export interface MetricsConfig {
  /** Enable metrics collection */
  enabled?: boolean;
  /** Export interval in milliseconds (default: 60000) */
  exportIntervalMs?: number;
  /**
   * Enable Node.js runtime metrics (event loop delay, GC duration, heap usage).
   * Uses @opentelemetry/instrumentation-runtime-node with perf_hooks.
   */
  runtimeMetrics?: boolean;
}

export interface ObservabilityConfig {
  /** Service name for resource identification */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Deployment environment (e.g. development, staging, production) */
  environment?: string;
  /** OTLP exporter configuration */
  otlp?: OtlpConfig;
  /** Logger configuration */
  logger?: LoggerConfig;
  /** Tracing configuration */
  tracing?: TracingConfig;
  /** Metrics configuration */
  metrics?: MetricsConfig;
}

export interface RequestMetrics {
  /** Histogram tracking HTTP request duration in milliseconds */
  duration: Histogram;
  /** Counter tracking total HTTP requests */
  total: Counter;
  /** UpDownCounter tracking currently active HTTP requests */
  active: UpDownCounter;
}

export interface ObservabilityContext {
  /** Configured Pino logger instance */
  logger: Logger;
  /** Gracefully shutdown all telemetry pipelines */
  shutdown: () => Promise<void>;
  /**
   * @fastify/otel plugin for request lifecycle tracing.
   * Register this BEFORE defining routes:
   *
   * ```ts
   * await app.register(ctx.fastifyOtelPlugin);
   * ```
   *
   * Only set when tracing is enabled.
   */
  fastifyOtelPlugin?: FastifyPluginCallback;
}
