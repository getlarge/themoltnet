/// <reference types='vitest' />
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/credentials',
  plugins: [
    nxCopyAssetsPlugin(['*.md']),
    dts({
      rollupTypes: true,
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
    }),
  ],
  // Configuration for building your library.
  // See: https://vite.dev/guide/build.html#library-mode
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    ssr: 'src/index.ts',
    rolldownOptions: {
      input: 'src/index.ts',
    },
  },
  test: {
    name: 'credentials',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/credentials',
      provider: 'v8' as const,
    },
  },
}));
