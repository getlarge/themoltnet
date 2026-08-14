import { defineConfig } from 'vite';

import { externalizeInstallableDependencies } from '../../vite.shared';

const external = externalizeInstallableDependencies(
  new URL('./package.json', import.meta.url),
);

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      external,
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    noExternal: [/@moltnet\//],
  },
  test: {
    exclude: ['node_modules/**', 'dist/**'],
  },
});
