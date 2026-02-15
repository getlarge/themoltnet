import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    root: resolve(import.meta.dirname),
    include: ['__tests__/e2e/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
