import { defineConfig } from '@hey-api/openapi-ts';

import { n8nClientPlugin } from './src/hey-api-n8n/plugin.js';

const clientPluginPath = decodeURIComponent(
  new URL('./src/hey-api-n8n/plugin.ts', import.meta.url).pathname,
);

export default defineConfig({
  input: '../../apps/rest-api/public/openapi.json',
  output: {
    format: 'prettier',
    path: './src/generated',
  },
  parser: {
    filters: {
      operations: {
        include: [
          'GET /agents/whoami',
          'GET /tasks',
          'POST /tasks',
          'GET /tasks/{id}',
          'POST /tasks/{id}/cancel',
          'GET /tasks/{id}/attempts',
        ],
      },
    },
  },
  plugins: [
    '@hey-api/typescript',
    n8nClientPlugin(clientPluginPath),
    { name: '@hey-api/sdk', client: true },
  ],
});
