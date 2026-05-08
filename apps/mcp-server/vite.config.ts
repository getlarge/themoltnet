import { defineConfig } from 'vite';

import { otelObservabilityExternals } from '../../vite.shared';

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    // Mirror the SSR entry as rolldownOptions.input so @nx/vite/plugin
    // recognizes this as buildable (its isBuildable check reads
    // build.lib || builder.buildApp || rollupOptions.input ||
    // rolldownOptions.input — but NOT build.ssr).
    rolldownOptions: {
      input: 'src/main.ts',
    },
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
      ...otelObservabilityExternals,
    ],
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
