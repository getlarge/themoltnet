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
    // 30s leaves headroom for CPU contention on shared 4-vCPU GHA runners
    // when ~25 other vitest tasks run alongside. Tests are pure mocks +
    // fastify in-process injection; wall clock is dominated by scheduling.
    // Revisit when issue #985 (Nx Cloud DTE) lands.
    testTimeout: 30_000,
  },
});
