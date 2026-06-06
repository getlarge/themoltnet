import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    rollupOptions: {
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    external: ['@themoltnet/sdk', 'absurd-sdk', 'pino'],
  },
  test: {
    exclude: ['node_modules/**', 'dist/**'],
  },
});
