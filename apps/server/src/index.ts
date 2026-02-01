import { buildApp } from './app.js';
import { loadServerConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadServerConfig();

  const app = await buildApp({
    config,
    logger:
      config.NODE_ENV === 'production'
        ? true
        : { transport: { target: 'pino-pretty' } },
  });

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.fatal(err, 'Failed to start server');
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
