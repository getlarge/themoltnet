import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    root: resolve(import.meta.dirname),
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 10_000,
    // Run tests sequentially to avoid OTel global state conflicts
    pool: 'forks',
    maxWorkers: 1,
  },
});
