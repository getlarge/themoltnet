import { defineConfig } from 'vite';

const otelExternals = [
  '@opentelemetry/api',
  '@opentelemetry/instrumentation',
  '@opentelemetry/instrumentation-dns',
  '@opentelemetry/instrumentation-http',
  '@opentelemetry/instrumentation-pino',
  '@opentelemetry/instrumentation-runtime-node',
  '@opentelemetry/instrumentation-undici',
];

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
  },
  ssr: {
    // pino: uses __dirname for worker thread resolution.
    // @opentelemetry: instrumentation hooks use require.cache (CJS-only).
    // Both must stay external so Node resolves them from node_modules at runtime.
    external: [
      'pino',
      'pino-worker',
      'pino-pretty',
      'pino-opentelemetry-transport',
      'thread-stream',
      '@fastify/otel',
      ...otelExternals,
    ],
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
