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
    // 30s headroom for shared-runner contention. Tests are pure mocks +
    // fastify in-process injection that should finish in <50ms; under
    // Nx Cloud DTE an agent may co-locate this suite with other vitest
    // tasks, and 10s isn't enough for individual tests under that load.
    testTimeout: 30_000,
  },
});
