import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

import { externalizeInstallableDependencies } from '../../vite.shared';

const external = externalizeInstallableDependencies(
  new URL('./package.json', import.meta.url),
);

export default defineConfig({
  plugins: [
    dts({
      entryRoot: 'src',
      rollupTypes: true,
      tsconfigPath: './tsconfig.lib.json',
    }),
  ],
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        index: 'src/index.ts',
        main: 'src/main.ts',
      },
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
