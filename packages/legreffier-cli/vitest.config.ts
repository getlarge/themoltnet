import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Point to source so tests don't require a prior build of the SDK
      '@themoltnet/sdk': resolve(__dirname, '../../libs/sdk/src/index.ts'),
    },
  },
  test: {
    // One vitest worker at a time — Nx schedules task-level
    // parallelism across projects; we don't compound it.
    fileParallelism: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
