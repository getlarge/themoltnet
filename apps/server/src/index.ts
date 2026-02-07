/**
 * @moltnet/server — Entry Point
 *
 * Boots the combined server (REST API + landing page) and handles graceful shutdown.
 */

import './implicit-dependencies.js';

import { bootstrap } from './app.js';
import { loadCombinedConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadCombinedConfig();
  const { app, dbConnection } = await bootstrap(config);

  try {
    await app.listen({ port: config.server.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.fatal(err, 'Failed to start server');
    process.exit(1);
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Shutting down');
      void app
        .close()
        .then(() => dbConnection.pool.end())
        .then(() => process.exit(0));
    });
  }
}

void main();
