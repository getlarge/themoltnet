import { defineConfig } from 'vite';

import { externalizeInstallableDependencies } from '../../vite.shared';

const external = externalizeInstallableDependencies(
  new URL('./package.json', import.meta.url),
);

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rolldownOptions: {
      external,
      input: 'src/main.ts',
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
    ssr: true,
    target: 'node22',
  },
  ssr: {
    noExternal: [/^@moltnet\//],
  },
});
