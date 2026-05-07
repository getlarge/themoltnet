import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    root: resolve(import.meta.dirname),
    include: ['__tests__/**/*.test.ts'],
    // e2e tests require DATABASE_URL; run separately via vitest.config.e2e.ts
    exclude: ['__tests__/e2e/**'],
    // CI failure mode: '[vitest-worker]: Timeout calling "onTaskUpdate"'
    // — vitest's parent↔fork IPC times out at 5s when worker threads
    // saturate the parent process's CPU budget. On a 4-vCPU agent the
    // sweet spot is maxThreads: 2 — each test file still runs in its
    // own thread (DBOS workflow queues register at module load,
    // requiring per-file isolation), but the parent stays responsive
    // to RPCs. Bumping to 4 made the timeout worse, not better.
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 2,
        minThreads: 1,
      },
    },
    testTimeout: 30_000,
  },
});
