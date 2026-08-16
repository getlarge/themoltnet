import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { restApiOtelExternals } from '../../vite.shared';

const DBOS_INTERNAL_MARKERS = [
  'class DBOSExecutor',
  'DBOSExecutor.globalInstance',
  'class DrizzleDataSource',
];

function rejectBundledDBOSInternals(): Plugin {
  return {
    name: 'reject-bundled-dbos-internals',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const marker = DBOS_INTERNAL_MARKERS.find((candidate) =>
          output.code.includes(candidate),
        );
        if (marker) {
          this.error(
            `${output.fileName} contains bundled DBOS internals (${marker}). ` +
              'Externalize @dbos-inc/dbos-sdk and @dbos-inc/drizzle-datasource.',
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [rejectBundledDBOSInternals()],
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
      '@dbos-inc/dbos-sdk',
      '@dbos-inc/drizzle-datasource',
      ...restApiOtelExternals,
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
