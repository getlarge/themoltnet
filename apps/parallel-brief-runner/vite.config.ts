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
    // Third-party deps stay external; the workspace @moltnet/orchestration lib
    // is bundled inline by vite SSR.
    external: ['@themoltnet/sdk', 'absurd-sdk', 'pino'],
  },
  test: {
    exclude: ['node_modules/**', 'dist/**'],
  },
});
