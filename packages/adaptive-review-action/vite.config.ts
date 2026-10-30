import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: 'esbuild',
    rollupOptions: {
      input: {
        review: 'src/review.ts',
        publish: 'src/publish.ts',
        outcomes: 'src/outcomes.ts',
        'diary-runtime': 'src/diary-runtime.ts',
      },
      // The optional runtime resolves these from its isolated pinned install.
      external: [/^@themoltnet\/(agent-daemon|pi-runtime)(\/|$)/],
      output: { format: 'esm', entryFileNames: '[name].js' },
    },
  },
  ssr: { noExternal: true },
});
