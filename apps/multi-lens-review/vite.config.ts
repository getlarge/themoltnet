import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'src/main.ts',
        'github-comment': 'src/github-comment.ts',
      },
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    // Third-party deps stay external; the workspace @themoltnet/tasks-orchestrator
    // lib is bundled inline by vite SSR.
    external: ['@themoltnet/sdk', 'absurd-sdk', 'pino'],
  },
  test: {
    exclude: ['node_modules/**', 'dist/**'],
  },
});
