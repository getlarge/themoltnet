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
    // Cap rest-api's fork pool at 2 instead of vitest's default
    // (numCPUs/2). The actual CI failure mode is
    //   `[vitest-worker]: Timeout calling "onTaskUpdate"`
    // — vitest worker→parent RPC times out at 5s when the runner is
    // CPU-saturated. With ~25 vitest tasks each spawning their own fork
    // pool on a 4-vCPU GHA box, the parent process can't service RPCs
    // fast enough. Bounding rest-api's forks (the heaviest suite) keeps
    // total concurrent forks reasonable while preserving file-level
    // parallelism. Each file still gets a clean fork so DBOS workflow
    // queue registrations don't collide.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
      },
    },
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
