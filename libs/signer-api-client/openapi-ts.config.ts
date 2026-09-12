import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../apps/moltnet-signer/openapi.json',
  output: {
    format: 'prettier',
    path: './src/generated',
  },
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
