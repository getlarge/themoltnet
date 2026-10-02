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
        prepare: 'src/prepare.ts',
        check: 'src/check.ts',
        review: 'src/review.ts',
        comment: 'src/comment.ts',
      },
      output: { format: 'esm', entryFileNames: '[name].js' },
    },
  },
  ssr: { noExternal: true },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
