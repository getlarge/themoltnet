import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    ssr: 'src/index.ts',
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
      /^@opentelemetry\//,
    ],
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
