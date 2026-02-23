import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    root: resolve(import.meta.dirname),
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.integration.test.ts'],
    testTimeout: 10_000,
    // DBOS integration tests share a single Postgres and cannot run in parallel:
    // concurrent launchDBOS() calls hit a unique constraint on dbos.dbos_migrations.
    fileParallelism: false,
  },
});
