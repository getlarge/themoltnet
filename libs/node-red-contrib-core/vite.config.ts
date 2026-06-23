import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

// Node-RED node sets: each runtime .js is paired with a sibling .html editor
// file. We bundle the .js (inlining @themoltnet/sdk so the published node is
// self-contained) and copy the .html alongside it.
const nodes = ['agent', 'tasks-create', 'workflow-status'];

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
      },
    },
  },
  ssr: {
    // Self-contained node: bundle the SDK and its workspace deps. Node built-ins
    // stay external automatically.
    noExternal: true,
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
