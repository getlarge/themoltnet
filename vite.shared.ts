// Vite 8/Rolldown accepts explicit package names in `ssr.external`.
// Keep these lists aligned with the runtime OpenTelemetry packages each app
// expects to resolve from node_modules.
export const otelObservabilityExternals = [
  '@opentelemetry/api',
  '@opentelemetry/exporter-metrics-otlp-proto',
  '@opentelemetry/exporter-trace-otlp-proto',
  '@opentelemetry/instrumentation',
  '@opentelemetry/instrumentation-dns',
  '@opentelemetry/instrumentation-http',
  '@opentelemetry/instrumentation-net',
  '@opentelemetry/instrumentation-pg',
  '@opentelemetry/instrumentation-pino',
  '@opentelemetry/instrumentation-runtime-node',
  '@opentelemetry/instrumentation-undici',
  '@opentelemetry/resources',
  '@opentelemetry/sdk-metrics',
  '@opentelemetry/sdk-trace-base',
  '@opentelemetry/sdk-trace-node',
  '@opentelemetry/semantic-conventions',
];

export const restApiOtelExternals = [
  ...otelObservabilityExternals,
  '@opentelemetry/exporter-logs-otlp-proto',
];
