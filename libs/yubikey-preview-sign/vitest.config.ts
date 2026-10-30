import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.spec.ts'],
    name: '@themoltnet/yubikey-preview-sign',
    watch: false,
  },
});
