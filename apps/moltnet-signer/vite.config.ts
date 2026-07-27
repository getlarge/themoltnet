import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
    ssr: true,
    target: 'node22',
  },
  ssr: {
    external: ['node-hid', 'typebox'],
  },
});
