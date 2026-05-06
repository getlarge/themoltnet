import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // One vitest worker at a time — Nx schedules task-level
    // parallelism across projects; we don't compound it.
    fileParallelism: false,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
