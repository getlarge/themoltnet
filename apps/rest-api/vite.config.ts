import { defineConfig } from 'vitest/config';

const otelExternals = [
  '@opentelemetry/api',
  '@opentelemetry/exporter-logs-otlp-proto',
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

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
  },
  ssr: {
    // drizzle-orm: ships pure ESM with no default export; Vite's CJS interop
    // incorrectly generates a default import when externalizing it.
    noExternal: ['drizzle-orm'],
    // pino: uses __dirname for worker thread resolution.
    // @opentelemetry: instrumentation hooks use require.cache (CJS-only).
    // Both must stay external so Node resolves them from node_modules.
    external: [
      'pino',
      'pino-worker',
      'pino-pretty',
      'pino-opentelemetry-transport',
      'thread-stream',
      '@fastify/otel',
      ...otelExternals,
      // onnxruntime-node uses native .node addons loaded via dynamic require().
      // Rollup cannot resolve these at bundle time; must stay external so Node
      // resolves them from node_modules at runtime.
      '@huggingface/transformers',
      'onnxruntime-node',
    ],
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
