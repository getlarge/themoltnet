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
    // 15s headroom for CPU contention on shared 4-vCPU GHA runners. The
    // CI test job caps Nx parallelism (--parallel=2) to keep the number
    // of concurrent vitest forks bounded; we cannot use vitest
    // singleFork: true here because rest-api registers DBOS workflow
    // queues as module-level side-effects and a single fork would hit
    // duplicate-queue errors across test files.
    testTimeout: 15_000,
  },
});
