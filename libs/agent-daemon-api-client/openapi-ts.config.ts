import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../apps/agent-daemon/openapi.json',
  output: './src/generated',
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
