import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
