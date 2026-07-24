import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    name: '@themoltnet/ctap',
    watch: false,
  },
});
