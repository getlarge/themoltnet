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
    // .nx/workflows/assignment-rules.yml caps `test` at parallelism: 1
    // per agent, so this suite gets the full 4-vCPU agent to itself.
    // Use threads (not forks) — each test file still runs in its own
    // thread (required: DBOS workflow queues register at module load
    // and would collide across files in a single thread), and we bump
    // the cap to 4 to match the runner's vCPU count.
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 4,
        minThreads: 2,
      },
    },
    testTimeout: 30_000,
  },
});
