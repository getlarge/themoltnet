import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@moltnet/api-client': resolve(
        import.meta.dirname,
        '../../libs/api-client/src/index.ts',
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
