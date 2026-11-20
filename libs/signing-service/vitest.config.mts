import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  resolve: {
    tsconfigPaths: true,
  },
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/signing-service',
  test: {
    name: 'signing-service',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.spec.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/signing-service',
      provider: 'v8' as const,
    },
  },
}));
