import { chmod } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { parseAllowedOrigins } from '@moltnet/loopback-companion';
import { OPERATOR_OAUTH } from '@moltnet/models';
import {
  createNodeSecretProviderRegistry,
  FileSecretProvider,
} from '@themoltnet/sdk/node';

import { loadAgentServerEnvConfig, processEnvSnapshot } from '../config.js';
import { ConnectionSettingsStore } from '../lib/agent-server/connection-settings.js';
import {
  AgentServerLockError,
  withAgentServerLock,
} from '../lib/agent-server/lock.js';
import {
  applyNativeClientGrant,
  NATIVE_TOKEN_ENV,
} from '../lib/agent-server/native-grant.js';
import { NativeGrantService } from '../lib/agent-server/native-grant-service.js';
import { validateNativeSocket } from '../lib/agent-server/native-socket.js';
import { OperatorOAuth } from '../lib/agent-server/operator-oauth.js';
import { ProviderLoginService } from '../lib/agent-server/provider-login.js';
import { RunManager } from '../lib/agent-server/runs.js';
import { RuntimeRegistry } from '../lib/agent-server/runtime-registry.js';
import { buildAgentServer } from '../lib/agent-server/server.js';
import {
  AgentServerStore,
  resolveAgentServerRoot,
} from '../lib/agent-server/store.js';
import { AGENT_SERVER_HELP, isHelpFlag } from '../lib/help.js';
import { createRootLogger } from '../lib/logger.js';
import { parseLocalOperationalSettings } from '../lib/options.js';
import { ProviderConfigurationService } from '../lib/provider-configuration.js';
import { installShutdownSignalHandlers } from '../lib/shutdown-signal.js';

/**
 * `moltnet-agent server` — per-user loopback supervisor (#2061).
 *
 * Starts nothing on its own: it binds 127.0.0.1 and waits for an authorized
 * Console origin to configure agents/providers and start/stop runs.
 */

const DEFAULT_PORT = OPERATOR_OAUTH.serverPort;
const DEFAULT_ALLOWED_ORIGINS = 'https://console.themolt.net';
const SHUTDOWN_TIMEOUT_MS = 15_000;

export function validateNativeSocketOptions(options: {
  nativeSocket?: string;
  supervised?: boolean;
  port?: string;
  allowedOrigins?: string;
}): string | undefined {
  if (!options.nativeSocket) return undefined;
  if (!options.supervised) return '--native-socket requires --supervised';
  if (options.port || options.allowedOrigins)
    return '--native-socket cannot be combined with TCP options';
  return undefined;
}

export async function runAgentServer(argv: string[]): Promise<number> {
  if (isHelpFlag(argv)) {
    console.log(AGENT_SERVER_HELP);
    return 0;
  }

  const envConfig = loadAgentServerEnvConfig();
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      'allowed-origins': { type: 'string' },
      root: { type: 'string' },
      'api-url': { type: 'string' },
      'heartbeat-interval-ms': { type: 'string' },
      'warm-retention-sec': { type: 'string' },
      supervised: { type: 'boolean' },
      'native-socket': { type: 'string' },
    },
  });

  const nativeSocket = values['native-socket'];
  const nativeSocketError = validateNativeSocketOptions({
    ...(nativeSocket ? { nativeSocket } : {}),
    ...(values.supervised ? { supervised: true } : {}),
    port: values.port || envConfig.port,
    allowedOrigins: values['allowed-origins'] || envConfig.allowedOrigins,
  });
  if (nativeSocketError) {
    console.error(nativeSocketError);
    return 1;
  }

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
  const settingsRoot =
    values.root ?? resolveAgentServerRoot({ root: envConfig.root });
  const connectionSettings = new ConnectionSettingsStore(settingsRoot, {
    ...envConfig.operatorOAuth,
    ...(values['api-url'] || envConfig.apiUrl
      ? { apiUrl: values['api-url'] || envConfig.apiUrl }
      : {}),
  });
  const connection = connectionSettings.view().effective;
  const root = connectionSettings.stateRoot(connection);
  const defaultApiUrl = connection.apiUrl;
  const runtimeSettings = parseLocalOperationalSettings(values);

  const store = new AgentServerStore(root).ensure();
  const { logger, shutdown: shutdownLogger } = createRootLogger({
    name: 'agent-daemon.server',
    level: envConfig.logLevel || 'info',
  });
  try {
    try {
      return await withAgentServerLock(
        root,
        async () => {
          const secrets = new FileSecretProvider({
            root: store.secretsDir,
            writable: true,
          });
          const secretProviders =
            createNodeSecretProviderRegistry().register(secrets);
          const externalSecretProviders = createNodeSecretProviderRegistry();
          const nativeGrant = new NativeGrantService();
          // Consumes MOLTNET_AGENT_SERVER_NATIVE_TOKEN from process.env, so
          // run children spawned later cannot inherit the desktop's token.
          const nativeClient = applyNativeClientGrant({
            nativeGrant,
            env: processEnvSnapshot(),
          });
          if (Boolean(values.supervised) && !nativeClient) {
            // A supervised server exists to be driven by the desktop app. With
            // no grant it passes its health check and rejects every control
            // request, which looks like a desktop bug rather than a missing
            // token. Refuse to start instead of appearing healthy.
            console.error(
              `A supervised Agent Server requires ${NATIVE_TOKEN_ENV}. ` +
                'Start it from MoltNet Agent, or omit --supervised to run it ' +
                'to reconnect Console to an operator already established by Desktop.',
            );
            return 1;
          }
          const shutdownController = new AbortController();
          const subscriptions = await ProviderLoginService.create({
            authPath: store.piAuthJsonPath,
            logger,
          });
          const providers = new ProviderConfigurationService({
            store,
            secrets,
            secretProviders,
            logger,
          });
          // One instance, so what a run can execute and what the catalogue
          // advertises as runnable cannot disagree.
          const runtimeRegistry = new RuntimeRegistry(store.root);
          const runs = new RunManager({
            store,
            secretProviders,
            externalSecretProviders,
            baseEnv: processEnvSnapshot(),
            logger,
            runtimeRegistry,
            runtimeSettings,
          });
          if (nativeSocket) await validateNativeSocket(nativeSocket);
          const selfOrigin = nativeSocket
            ? undefined
            : `http://127.0.0.1:${port}`;
          const operatorOAuth = new OperatorOAuth(
            {
              issuer: connection.issuer,
              authorizationUrl: new URL('/oauth2/auth', connection.publicUrl)
                .href,
              tokenUrl: new URL('/oauth2/token', connection.publicUrl).href,
              jwksUrl: new URL('/.well-known/jwks.json', connection.publicUrl)
                .href,
              nativeClientId: connection.nativeClientId,
              consoleClientId: connection.consoleClientId,
              callbackPort: OPERATOR_OAUTH.callbackPort,
            },
            root,
          );
          const app = buildAgentServer({
            operatorOAuth,
            nativeOnly: Boolean(nativeSocket),
            connectionSettings,
            operatorApiUrl: connection.apiUrl,
            store,
            secrets,
            secretProviders,
            externalSecretProviders,
            nativeGrant,
            runs,
            subscriptions,
            providers,
            runtimeRegistry,
            allowedOrigins: nativeSocket ? [] : allowedOrigins,
            ...(selfOrigin ? { selfOrigin } : {}),
            defaultApiUrl,
            runtimeSettings,
            ...(envConfig.activeIdentity
              ? { activeIdentity: envConfig.activeIdentity }
              : {}),
            version: 'dev',
            logger,
            shutdownSignal: shutdownController.signal,
          });

          try {
            const address = await app.listen(
              nativeSocket
                ? { path: nativeSocket }
                : { host: '127.0.0.1', port },
            );
            if (nativeSocket) await chmod(nativeSocket, 0o600);
            console.error(`moltnet-agent server listening on ${address}`);
            console.error(`config root: ${root}`);
            if (nativeSocket)
              console.error(`native control socket: ${nativeSocket}`);
            else console.error(`allowed origins: ${allowedOrigins.join(', ')}`);
            if (nativeClient) {
              console.error('native desktop client: authorized');
            }
            if (!nativeSocket)
              console.error(
                'Connect from an allowed local-control client after operator authorization.',
              );

            return await waitForAgentServerShutdown(
              runs,
              app,
              shutdownController,
              Boolean(values.supervised),
            );
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
      if (cause instanceof AgentServerLockError) {
        console.error(cause.message);
        return 1;
      }
      throw cause;
    }
  } finally {
    await shutdownLogger();
  }
}

function waitForAgentServerShutdown(
  runs: RunManager,
  app: {
    close(): Promise<unknown>;
    server: { closeAllConnections(): void };
  },
  shutdownController: AbortController,
  supervised: boolean,
): Promise<number> {
  return new Promise<number>((resolvePromise) => {
    let shuttingDown = false;
    const shutdown = (source?: 'stdin'): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (source === 'stdin') console.error('shutting down: stdin EOF');
      shutdownController.abort({ source: 'shutdown' });
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
          // Never return ownership to withAgentServerLock while cleanup is still
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
        stdinGuard.dispose();
        const exitCode =
          typeof process.exitCode === 'number' ? process.exitCode : 0;
        resolvePromise(failures.length > 0 ? 1 : exitCode);
      })();
    };
    const handlers = installShutdownSignalHandlers({
      logDrain: () => console.error('shutting down: stopping runs…'),
      drain: () => shutdown(),
    });
    const stdinGuard = installSupervisedStdinGuard({
      enabled: supervised,
      shutdown: () => shutdown('stdin'),
    });
  });
}

interface SupervisedStdin {
  readableEnded?: boolean;
  once(event: 'end', listener: () => void): unknown;
  off(event: 'end', listener: () => void): unknown;
  resume(): unknown;
}

/** Makes the supervising process's stdin pipe part of the server lifecycle. */
export function installSupervisedStdinGuard(options: {
  enabled: boolean;
  shutdown: () => void;
  input?: SupervisedStdin;
}): { dispose: () => void } {
  if (!options.enabled) return { dispose: () => undefined };
  const input = options.input ?? process.stdin;
  const onEnd = (): void => options.shutdown();
  input.once('end', onEnd);
  input.resume();
  if (input.readableEnded) queueMicrotask(onEnd);
  return { dispose: () => input.off('end', onEnd) };
}
