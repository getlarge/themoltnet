import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const publishedRuntimeExternals = [
  '@themoltnet/agent-runtime',
  '@themoltnet/sdk',
  '@themoltnet/shell-command-analyzer',
];

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
      external: publishedRuntimeExternals,
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
