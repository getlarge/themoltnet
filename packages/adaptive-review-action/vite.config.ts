import { cpSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const manifest = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
    version: string;
  };

export default defineConfig({
  plugins: [
    {
      name: 'bundle-review-worker',
      closeBundle() {
        // Nx builds this workspace dependency first. Keep the worker in the
        // same digest-verified artifact used by every review job.
        const worker = new URL('../agent-daemon-action/dist/', import.meta.url);
        if (!statSync(new URL('main.js', worker)).size) {
          throw new Error(
            'Build agent-daemon-action before adaptive-review-action',
          );
        }
        cpSync(worker, `${root}dist/worker-action`, { recursive: true });
        writeFileSync(
          `${root}dist/release-dependencies.json`,
          JSON.stringify(
            {
              schemaVersion: 1,
              daemonVersion: manifest('../../apps/agent-daemon/package.json')
                .version,
              workerActionVersion: manifest(
                '../agent-daemon-action/package.json',
              ).version,
            },
            null,
            2,
          ) + '\n',
        );
      },
    },
  ],
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: 'esbuild',
    rollupOptions: {
      input: {
        review: 'src/review.ts',
        publish: 'src/publish.ts',
        outcomes: 'src/outcomes.ts',
        'diary-runtime': 'src/diary-runtime.ts',
      },
      // The optional runtime resolves these from its isolated pinned install.
      external: [/^@themoltnet\/(agent-daemon|pi-runtime)(\/|$)/],
      output: { format: 'esm', entryFileNames: '[name].js' },
    },
  },
  ssr: { noExternal: true },
});
