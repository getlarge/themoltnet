import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

// Node-RED node sets: each runtime .js is paired with a sibling .html editor
// file. We bundle the .js (externalizing @themoltnet/sdk, which npm installs
// for consumers) and copy the .html alongside it.
const nodes = [
  'agent',
  'runtime-profile',
  'tasks-create',
  'task-get',
  'task-wait',
  'workflow-status',
  'task-builder',
  'task-reader',
];

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: {
      input: Object.fromEntries(
        nodes.map((n) => [`nodes/${n}`, resolve(here, `src/nodes/${n}.ts`)]),
      ),
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        // Each Node-RED node loads as a standalone module; inline shared
        // helpers (task-snapshot) into every entry so there is no
        // cross-referenced chunk under assets/ to ship and resolve.
        manualChunks: undefined,
        chunkFileNames: 'nodes/[name].js',
      },
    },
  },
  ssr: {
    // Externalize the published SDK — npm installs @themoltnet/sdk (and its
    // public transitive deps) for consumers, so the bundle stays small. Any
    // private @moltnet/* workspace deps used directly stay inlined.
    external: ['@themoltnet/sdk'],
    noExternal: [/@moltnet\//],
  },
  plugins: [
    {
      name: 'copy-node-red-html',
      closeBundle() {
        mkdirSync(resolve(here, 'dist/nodes'), { recursive: true });
        for (const n of nodes) {
          copyFileSync(
            resolve(here, `src/nodes/${n}.html`),
            resolve(here, `dist/nodes/${n}.html`),
          );
        }
      },
    },
  ],
});
