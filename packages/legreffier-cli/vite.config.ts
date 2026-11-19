import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist',
    rolldownOptions: {
      input: 'src/index.ts',
      output: {
        entryFileNames: 'index.js',
        format: 'esm',
      },
      external: [/^node:/],
    },
  },
});
