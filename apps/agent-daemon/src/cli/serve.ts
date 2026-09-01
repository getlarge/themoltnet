/**
 * `moltnet-agent serve` — per-user loopback supervisor (#2061).
 *
 * Starts nothing on its own: it binds 127.0.0.1 and waits for a paired
 * Console origin to configure agents/providers and start/stop runs.
 */
import { parseArgs } from 'node:util';

import { parseAllowedOrigins } from '@moltnet/loopback-companion';
import { FileSecretProvider } from '@themoltnet/sdk/node';

import { loadServeEnvConfig, processEnvSnapshot } from '../config.js';
import { isHelpFlag, SERVE_HELP } from '../lib/help.js';
import { PairingService } from '../lib/serve/pairing.js';
import { RunManager } from '../lib/serve/runs.js';
import { buildServeServer } from '../lib/serve/server.js';
import { resolveServeRoot, ServeStore } from '../lib/serve/store.js';

const DEFAULT_PORT = 17374;
const DEFAULT_ALLOWED_ORIGINS = 'https://console.themolt.net';
const DEFAULT_API_URL = 'https://api.themolt.net';

export async function runServe(argv: string[]): Promise<number> {
  if (isHelpFlag(argv)) {
    console.log(SERVE_HELP);
    return 0;
  }

  const envConfig = loadServeEnvConfig();
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      'allowed-origins': { type: 'string' },
      root: { type: 'string' },
      'api-url': { type: 'string' },
    },
  });

  const port = Number.parseInt(
    values.port ?? (envConfig.port || `${DEFAULT_PORT}`),
    10,
  );
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    console.error(`Invalid --port: ${String(values.port)}`);
    return 1;
  }
  const allowedOrigins = parseAllowedOrigins(
    values['allowed-origins'] ??
      (envConfig.allowedOrigins || DEFAULT_ALLOWED_ORIGINS),
  );
  const root =
    values.root ??
    resolveServeRoot({
      root: envConfig.root,
      xdgConfigHome: envConfig.xdgConfigHome,
    });
  const defaultApiUrl =
    values['api-url'] ?? (envConfig.apiUrl || DEFAULT_API_URL);

  const store = new ServeStore(root).ensure();
  const secrets = new FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
  const pairing = new PairingService(store);
  const runs = new RunManager({
    store,
    secrets,
    baseEnv: processEnvSnapshot(),
  });
  const selfOrigin = `http://127.0.0.1:${port}`;
  const app = buildServeServer({
    store,
    secrets,
    pairing,
    runs,
    allowedOrigins,
    selfOrigin,
    defaultApiUrl,
    version: 'dev',
  });

  const address = await app.listen({ host: '127.0.0.1', port });
  console.error(`moltnet-agent serve listening on ${address}`);
  console.error(`config root: ${root}`);
  console.error(`allowed origins: ${allowedOrigins.join(', ')}`);
  console.error(
    'Pair from the Console "Local runtime" page; approve the one-click prompt this server opens.',
  );

  return new Promise<number>((resolvePromise) => {
    let shuttingDown = false;
    const shutdown = (): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.error('shutting down: stopping runs…');
      void runs
        .stopAll()
        .catch(() => undefined)
        .then(() => app.close())
        .catch(() => undefined)
        .then(() => resolvePromise(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
