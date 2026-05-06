import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One vitest worker at a time — Nx schedules task-level
    // parallelism across projects; we don't compound it.
    fileParallelism: false,
    globals: false,
    environment: 'node',
    root: resolve(import.meta.dirname),
    include: ['e2e/**/*.e2e.test.ts'],
    globalSetup: './e2e/globalSetup.ts',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
