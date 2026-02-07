import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
  },
  ssr: {
    // drizzle-orm: ships pure ESM with no default export; Vite's CJS interop
    // incorrectly generates a default import when externalizing it.
    noExternal: ['drizzle-orm'],
    // pino: uses __dirname for worker thread resolution — cannot be bundled
    // in ESM. Must stay external so Node resolves it from node_modules.
    external: [
      'pino',
      'pino-worker',
      'pino-pretty',
      'pino-opentelemetry-transport',
      'thread-stream',
    ],
  },
});
