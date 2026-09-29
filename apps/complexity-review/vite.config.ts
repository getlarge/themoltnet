import { defineConfig } from 'vite';

import { externalizeInstallableDependencies } from '../../vite.shared';

const external = externalizeInstallableDependencies(
  new URL('./package.json', import.meta.url),
);

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: { main: 'src/main.ts' },
      external,
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    noExternal: [/@moltnet\//],
  },
});
