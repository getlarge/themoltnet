import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { restApiOtelExternals } from '../../vite.shared';

function precompileResponseSerializers(): Plugin {
  let migrationBuild = false;
  return {
    name: 'precompile-response-serializers',
    apply: 'build',
    configResolved(config) {
      migrationBuild =
        typeof config.build.ssr === 'string' &&
        config.build.ssr.endsWith('src/migrate.ts');
    },
    generateBundle() {
      if (migrationBuild) return;
      const directory = mkdtempSync(join(tmpdir(), 'moltnet-serializers-'));
      const output = join(directory, 'response-serializers.cjs');
      try {
        execFileSync(
          process.execPath,
          ['--import', 'tsx', 'scripts/generate-serializers.ts', output],
          {
            cwd: fileURLToPath(new URL('.', import.meta.url)),
            stdio: 'inherit',
          },
        );
        this.emitFile({
          type: 'asset',
          fileName: 'response-serializers.cjs',
          source: readFileSync(output, 'utf8'),
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

function rejectBundledDBOSInternals(): Plugin {
  return {
    name: 'reject-bundled-dbos-internals',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const dbosModuleId = output.moduleIds.find((moduleId) =>
          moduleId.replaceAll('\\', '/').includes('/@dbos-inc/'),
        );
        if (dbosModuleId) {
          this.error(
            `${output.fileName} contains bundled DBOS module ${dbosModuleId}. ` +
              'Externalize @dbos-inc/dbos-sdk and @dbos-inc/drizzle-datasource.',
          );
        }
      }
    },
  };
}

export default defineConfig({
  define: { __MOLTNET_PRECOMPILED_SERIALIZERS__: 'true' },
  plugins: [rejectBundledDBOSInternals(), precompileResponseSerializers()],
  build: {
    // `ssr: true` (not an entry path) so Vite builds every entry in
    // rolldownOptions.input; a string here would override that map. The
    // input map also lets @nx/vite/plugin recognize this as buildable (its
    // isBuildable check does not read build.ssr).
    ssr: true,
    outDir: 'dist',
    rolldownOptions: {
      input: {
        main: 'src/main.ts',
        // Worker thread entry loaded by @moltnet/embedding-service at runtime
        // from `./embedding-worker-thread.js` next to main.js.
        'embedding-worker-thread': fileURLToPath(
          import.meta.resolve('@moltnet/embedding-service/worker-thread'),
        ),
      },
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
