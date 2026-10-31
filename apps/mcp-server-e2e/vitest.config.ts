import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    globals: false,
    environment: 'node',
    root: resolve(import.meta.dirname),
    include: ['src/**/*.e2e.spec.ts'],
    globalSetup: './src/globalSetup.ts',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
