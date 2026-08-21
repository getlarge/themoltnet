import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

import { externalizeInstallableDependencies } from '../../vite.shared';

const external = externalizeInstallableDependencies(
  new URL('./package.json', import.meta.url),
);

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      bundledPackages: ['@moltnet/models', '@moltnet/tasks'],
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    }),
  ],
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      // Published workspace dependencies are installed by package consumers.
      // In particular, the analyzer owns runtime WASM assets whose
      // import.meta.url paths are detached when its source export is bundled.
      external,
      input: 'src/index.ts',
    },
  },
  ssr: {
    noExternal: [/^@moltnet\//],
  },
  test: {
    exclude: ['node_modules/**', 'dist/**'],
  },
});
