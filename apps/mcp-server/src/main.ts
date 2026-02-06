import { createClient } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { McpDeps } from './types.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const client = createClient({ baseUrl: config.REST_API_URL });

  const deps: McpDeps = {
    client,
    getAccessToken: () => config.ACCESS_TOKEN ?? null,
    signMessage: async (message: string, privateKey: Uint8Array) => {
      const base64Key = Buffer.from(privateKey).toString('base64');
      return cryptoService.sign(message, base64Key);
    },
  };

  const app = await buildApp({
    config,
    deps,
    logger:
      config.NODE_ENV === 'production'
        ? true
        : { transport: { target: 'pino-pretty' } },
  });

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.fatal(err, 'Failed to start MCP server');
    process.exit(1);
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Shutting down');
      void app.close().then(() => process.exit(0));
    });
  }
}

void main();
