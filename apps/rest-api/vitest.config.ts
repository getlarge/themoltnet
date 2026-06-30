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
    // Randomize test order so cross-test state bleed surfaces in CI rather than
    // only when a contributor remembers to run --sequence.shuffle manually.
    // These suites share one Fastify app per `describe` block (#1512) and reset
    // mocks per test via resetMockServices; any state that leaks outside `mocks`
    // (e.g. a module-level vi.mock not cleared in beforeEach) becomes a flaky
    // failure under shuffle instead of a silent pass under fixed order. See
    // __tests__/README.md.
    sequence: { shuffle: true },
  },
});
