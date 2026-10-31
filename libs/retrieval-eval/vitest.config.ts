import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['__tests__/**/*.spec.{ts,tsx}'],
    exclude: ['**/*.integration.spec.ts'],
  },
});
