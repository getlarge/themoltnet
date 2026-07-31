import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

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
      // The analyzer owns runtime WASM assets whose import.meta.url paths are
      // detached when its source-direct workspace export is bundled here.
      external: ['@themoltnet/shell-command-analyzer'],
      input: 'src/index.ts',
    },
  },
  ssr: {
    noExternal: [/^@moltnet\//, /^typebox(?:\/.*)?$/],
  },
  test: {
    exclude: ['node_modules/**', 'dist/**'],
  },
});
