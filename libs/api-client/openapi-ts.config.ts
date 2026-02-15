import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../apps/rest-api/public/openapi.json',
  output: './src/generated',
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
