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
    // — vitest's parent↔fork IPC times out at 5s when the agent is
    // CPU-saturated (default fork pool spawns ~numCPUs/2 forks per
    // vitest task). Switch to threads with a tight max=2, min=1: each
    // test file still gets its own thread (DBOS workflow queues
    // register at module load, so we can't share threads across files),
    // but the box runs at most 2 worker threads at a time. Mirrors the
    // pre-DTE '--pool=threads --maxThreads=2 --minThreads=1' incantation.
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
