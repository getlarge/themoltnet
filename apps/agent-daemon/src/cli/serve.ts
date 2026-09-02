/**
 * `moltnet-agent serve` — per-user loopback supervisor (#2061).
 *
 * Starts nothing on its own: it binds 127.0.0.1 and waits for a paired
 * Console origin to configure agents/providers and start/stop runs.
 */
import { parseArgs } from 'node:util';

import { parseAllowedOrigins } from '@moltnet/loopback-companion';
import {
  createNodeSecretProviderRegistry,
  FileSecretProvider,
} from '@themoltnet/sdk/node';

import { loadServeEnvConfig, processEnvSnapshot } from '../config.js';
import { isHelpFlag, SERVE_HELP } from '../lib/help.js';
import { createRootLogger } from '../lib/logger.js';
import { PairingService } from '../lib/serve/pairing.js';
import { ProviderLoginService } from '../lib/serve/provider-login.js';
import { RunManager } from '../lib/serve/runs.js';
import { ServeLockError, withServeLock } from '../lib/serve/serve-lock.js';
import { buildServeServer } from '../lib/serve/server.js';
import { resolveServeRoot, ServeStore } from '../lib/serve/store.js';
import { installShutdownSignalHandlers } from '../lib/shutdown-signal.js';

const DEFAULT_PORT = 17374;
const DEFAULT_ALLOWED_ORIGINS = 'https://console.themolt.net';
const DEFAULT_API_URL = 'https://api.themolt.net';
const SHUTDOWN_TIMEOUT_MS = 15_000;

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
  const { logger, shutdown: shutdownLogger } = createRootLogger({
    name: 'agent-daemon.serve',
    level: envConfig.logLevel || 'info',
  });
  try {
    try {
      return await withServeLock(
        root,
        async () => {
          const secrets = new FileSecretProvider({
            root: store.secretsDir,
            writable: true,
          });
          const secretProviders =
            createNodeSecretProviderRegistry().register(secrets);
          const externalSecretProviders = createNodeSecretProviderRegistry();
          const pairing = new PairingService();
          const shutdownController = new AbortController();
          const subscriptions = new ProviderLoginService({
            authPath: store.piAuthJsonPath,
          });
          const runs = new RunManager({
            store,
            secretProviders,
            externalSecretProviders,
            baseEnv: processEnvSnapshot(),
            logger,
          });
          const selfOrigin = `http://127.0.0.1:${port}`;
          const app = buildServeServer({
            store,
            secrets,
            secretProviders,
            externalSecretProviders,
            pairing,
            runs,
            subscriptions,
            allowedOrigins,
            selfOrigin,
            defaultApiUrl,
            version: 'dev',
            logger,
            shutdownSignal: shutdownController.signal,
          });

          try {
            const address = await app.listen({ host: '127.0.0.1', port });
            console.error(`moltnet-agent serve listening on ${address}`);
            console.error(`config root: ${root}`);
            console.error(`allowed origins: ${allowedOrigins.join(', ')}`);
            console.error(
              'Pair from the Console "Local runtime" page; approve the one-click prompt this server opens.',
            );

            return await waitForServeShutdown(runs, app, shutdownController);
          } catch (cause) {
            await app.close().catch(() => undefined);
            throw cause;
          }
        },
        {
          onCompromised: (error) => {
            console.error(error.message);
            process.exitCode = 1;
            process.kill(process.pid, 'SIGTERM');
          },
        },
      );
    } catch (cause) {
      if (cause instanceof ServeLockError) {
        console.error(cause.message);
        return 1;
      }
      throw cause;
    }
  } finally {
    await shutdownLogger();
  }
}

function waitForServeShutdown(
  runs: RunManager,
  app: {
    close(): Promise<unknown>;
    server: { closeAllConnections(): void };
  },
  shutdownController: AbortController,
): Promise<number> {
  return new Promise<number>((resolvePromise) => {
    let shuttingDown = false;
    const shutdown = (): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      shutdownController.abort();
      void (async () => {
        app.server.closeAllConnections();
        const cleanupPromise = Promise.allSettled([
          runs.stopAll(),
          app.close(),
        ]);
        let timedOut = false;
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          cleanupPromise,
          new Promise<void>((resolveDeadline) => {
            deadlineTimer = setTimeout(() => {
              timedOut = true;
              resolveDeadline();
            }, SHUTDOWN_TIMEOUT_MS);
          }),
        ]);
        if (deadlineTimer) clearTimeout(deadlineTimer);
        let forcedExitTimer: ReturnType<typeof setTimeout> | undefined;
        if (timedOut) {
          console.error(
            'shutdown cleanup exceeded its 15 second deadline; force-stopping runs',
          );
          runs.forceStopAll();
          app.server.closeAllConnections();
          // Never return ownership to withServeLock while cleanup is still
          // pending. If forced cleanup also stalls, exit with the lock held;
          // proper-lockfile will recover it only after this process is gone.
          forcedExitTimer = setTimeout(() => process.exit(1), 2_000);
        }
        const results = await cleanupPromise;
        if (forcedExitTimer) clearTimeout(forcedExitTimer);
        const failures = results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        );
        for (const failure of failures) {
          console.error(
            `shutdown cleanup failed: ${(failure.reason as Error).message}`,
          );
        }
        handlers.dispose();
        const exitCode =
          typeof process.exitCode === 'number' ? process.exitCode : 0;
        resolvePromise(failures.length > 0 ? 1 : exitCode);
      })();
    };
    const handlers = installShutdownSignalHandlers({
      logDrain: () => console.error('shutting down: stopping runs…'),
      drain: shutdown,
    });
  });
}
