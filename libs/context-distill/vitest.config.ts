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
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
