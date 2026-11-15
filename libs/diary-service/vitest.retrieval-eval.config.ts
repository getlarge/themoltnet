import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: resolve(import.meta.dirname),
    environment: 'node',
    include: ['evals/**/*.eval.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
  },
});
