import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export const config = {
  runner: 'local',
  specs: ['./chrome.spec.ts'],
  maxInstances: 1,
  framework: 'mocha',
  reporters: ['spec'],
  logLevel: 'warn',
  mochaOpts: { timeout: 30_000 },
  services: [
    [
      '@wdio/tauri-service',
      {
        mode: 'browser',
        devServer: async () => {
          const server = await createServer({
            configFile: `${projectRoot}/e2e/vite.config.ts`,
            server: { host: '127.0.0.1', port: 0, strictPort: false },
          });
          await server.listen();
          const url = server.resolvedUrls?.local[0];
          if (!url) {
            await server.close();
            throw new Error('Vite did not publish its fixture URL');
          }
          return {
            url,
            close: () => server.close(),
          };
        },
      },
    ],
  ],
  capabilities: [
    {
      browserName: 'tauri',
      'goog:chromeOptions': {
        args: ['--headless=new', '--window-size=820,720'],
      },
    },
  ],
};
