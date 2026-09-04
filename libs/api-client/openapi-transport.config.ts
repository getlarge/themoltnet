import { defineConfig } from '@hey-api/openapi-ts';

import { transportClientPlugin } from './generator/transport-client/plugin.js';

const transportClientPluginPath = decodeURIComponent(
  new URL('./generator/transport-client/plugin.ts', import.meta.url).pathname,
);

export default defineConfig({
  input: '../../apps/rest-api/public/openapi.json',
  output: {
    format: 'prettier',
    path: './src/generated-transport',
  },
  plugins: [
    '@hey-api/typescript',
    transportClientPlugin(transportClientPluginPath),
    { name: '@hey-api/sdk', client: true },
  ],
});
