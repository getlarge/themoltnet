import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The SDK exports from dist/ (it's a published package), but we
      // want vitest to resolve to source for workspace development.
      '@themoltnet/sdk': resolve(
        import.meta.dirname,
        '../../libs/sdk/src/index.ts',
      ),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    root: resolve(import.meta.dirname),
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
