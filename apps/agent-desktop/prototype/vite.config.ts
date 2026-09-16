import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * PROTOTYPE ONLY. Serves the fixture-backed Run Center in a plain browser so
 * the design can be reviewed and screenshotted before the desktop-control
 * contract exists. It is not referenced by the app build and must not ship.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      // Replace only the Tauri IPC boundary. `src/bridge.ts`, `ServerPanel`
      // and every Run Center view are the real modules.
      '@tauri-apps/api/core': fileURLToPath(
        new URL('./tauri-core-stub.ts', import.meta.url),
      ),
      '@tauri-apps/api/event': fileURLToPath(
        new URL('./tauri-event-stub.ts', import.meta.url),
      ),
    },
  },
  server: { port: 1421, strictPort: true },
});
