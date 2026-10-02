import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../apps/moltnet-signer/openapi.json',
  output: {
    postProcess: ['prettier'],
    path: './src/generated',
  },
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
