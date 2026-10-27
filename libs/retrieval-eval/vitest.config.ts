import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts'],
  },
});
