import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    root: resolve(import.meta.dirname),
    include: ['src/adaptive-review.e2e.spec.ts'],
    globalSetup: './src/globalSetup.ts',
    testTimeout: 150_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
