import { defineConfig } from '@hey-api/openapi-ts';

import { apiBindingsPlugin } from './generator/api-bindings/plugin.js';

const apiBindingsPluginPath = decodeURIComponent(
  new URL('./generator/api-bindings/plugin.ts', import.meta.url).pathname,
);

export default defineConfig({
  input: '../../apps/rest-api/public/openapi.json',
  output: {
    format: 'prettier',
    path: './src/generated-api-bindings',
  },
  plugins: [
    '@hey-api/typescript',
    apiBindingsPlugin(apiBindingsPluginPath),
    { name: '@hey-api/sdk', client: true },
  ],
});
