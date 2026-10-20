import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: 'esbuild',
    rollupOptions: {
      input: { review: 'src/review.ts', publish: 'src/publish.ts' },
      output: { format: 'esm', entryFileNames: '[name].js' },
    },
  },
  ssr: { noExternal: true },
});
