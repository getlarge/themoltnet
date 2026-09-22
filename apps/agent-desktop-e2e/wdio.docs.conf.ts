import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * Captures the documentation screenshots from the real renderer with mocked
 * native commands. Separate from the journey configs: it writes into
 * `docs/public/screenshots` and runs only when the shots are regenerated.
 */
export const config = {
  onPrepare() {
    mkdirSync('../../docs/public/screenshots', { recursive: true });
  },
  runner: 'local',
  specs: ['./src/docs-capture.spec.ts'],
  maxInstances: 1,
  framework: 'mocha',
  reporters: ['spec'],
  logLevel: 'error',
  mochaOpts: { timeout: 60_000 },
  services: [
    [
      '@wdio/tauri-service',
      {
        mode: 'browser',
        devServer: async () => {
          const server = await createServer({
            configFile: `${projectRoot}/vite.config.ts`,
            server: { host: '127.0.0.1', port: 0, strictPort: false },
          });
          await server.listen();
          const url = server.resolvedUrls?.local[0];
          if (!url) {
            await server.close();
            throw new Error('Vite did not publish its fixture URL');
          }
          return { url, close: () => server.close() };
        },
      },
    ],
  ],
  capabilities: [
    {
      browserName: 'tauri',
      'goog:chromeOptions': {
        // Retina output, as the landing screenshots use.
        args: [
          '--headless=new',
          '--window-size=1100,860',
          '--force-device-scale-factor=2',
          '--hide-scrollbars',
        ],
      },
    },
  ],
};
