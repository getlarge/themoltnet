import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

const assets = [
  ['nodes/MoltNet/MoltNet.node.json', 'nodes/MoltNet/MoltNet.node.json'],
  ['nodes/MoltNet/moltnet-mark.svg', 'nodes/MoltNet/moltnet-mark.svg'],
  [
    'nodes/MoltNet/moltnet-mark.dark.svg',
    'nodes/MoltNet/moltnet-mark.dark.svg',
  ],
];

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      external: ['n8n-workflow'],
      input: {
        'credentials/MoltNetAgentApi.credentials': resolve(
          here,
          'credentials/MoltNetAgentApi.credentials.ts',
        ),
        'credentials/MoltNetOAuth2Api.credentials': resolve(
          here,
          'credentials/MoltNetOAuth2Api.credentials.ts',
        ),
        'nodes/MoltNet/MoltNet.node': resolve(
          here,
          'nodes/MoltNet/MoltNet.node.ts',
        ),
      },
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
        exports: 'named',
      },
    },
  },
  ssr: {
    external: ['n8n-workflow'],
    // The private generated client is a build input and must not leak into the
    // published runtime manifest.
    noExternal: [/@moltnet\//],
  },
  plugins: [
    {
      name: 'copy-n8n-assets',
      closeBundle() {
        for (const [source, destination] of assets) {
          const output = resolve(here, 'dist', destination);
          mkdirSync(dirname(output), { recursive: true });
          copyFileSync(resolve(here, source), output);
        }
      },
    },
  ],
});
