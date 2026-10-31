import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    fileParallelism: false,
    include: ['__tests__/**/*.integration.spec.ts'],
    testTimeout: 240000,
  },
});
