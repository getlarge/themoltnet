import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../apps/moltnet-signer/openapi.json',
  output: './src/generated',
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
