import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  test: {
    include: ['__tests__/**/*.spec.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./__tests__/test-setup.ts'],
  },
});
