/**
 * `moltnet-agent server` — per-user loopback supervisor (#2061).
 *
 * Starts nothing on its own: it binds 127.0.0.1 and waits for a paired
 * Console origin to configure agents/providers and start/stop runs.
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { parseAllowedOrigins } from '@moltnet/loopback-companion';
import {
  createNodeSecretProviderRegistry,
  FileSecretProvider,
} from '@themoltnet/sdk/node';

import { loadAgentServerEnvConfig, processEnvSnapshot } from '../config.js';
import {
  AgentServerLockError,
  withAgentServerLock,
} from '../lib/agent-server/lock.js';
import {
  applyNativeClientGrant,
  NATIVE_TOKEN_ENV,
} from '../lib/agent-server/native-grant.js';
import { PairingService } from '../lib/agent-server/pairing.js';
import { ProviderLoginService } from '../lib/agent-server/provider-login.js';
import { RunManager } from '../lib/agent-server/runs.js';
import { RuntimeRegistry } from '../lib/agent-server/runtime-registry.js';
import { buildAgentServer } from '../lib/agent-server/server.js';
import {
  AgentServerStore,
  resolveAgentServerRoot,
} from '../lib/agent-server/store.js';
import {
  ensureLocalTlsMaterial,
  isLocalCaTrusted,
  isMacos,
  removeLocalCa,
  trustLocalCa,
} from '../lib/agent-server/tls.js';
import { AGENT_SERVER_HELP, isHelpFlag } from '../lib/help.js';
import { createRootLogger } from '../lib/logger.js';
import { parseLocalOperationalSettings } from '../lib/options.js';
import { ProviderConfigurationService } from '../lib/provider-configuration.js';
import { installShutdownSignalHandlers } from '../lib/shutdown-signal.js';

const DEFAULT_PORT = 17374;
const DEFAULT_ALLOWED_ORIGINS = 'https://console.themolt.net';
const DEFAULT_API_URL = 'https://api.themolt.net';
const SHUTDOWN_TIMEOUT_MS = 15_000;

export async function runAgentServer(argv: string[]): Promise<number> {
  if (isHelpFlag(argv)) {
    console.log(AGENT_SERVER_HELP);
    return 0;
  }

  const trustRequested = argv[0] === 'trust';
  const commandArgs = trustRequested ? argv.slice(1) : argv;
  const envConfig = loadAgentServerEnvConfig();
  if (trustRequested) {
    return runTrustCommand(
      commandArgs,
      resolveAgentServerRoot({ root: envConfig.root }),
    );
  }
  const { values } = parseArgs({
    args: commandArgs,
    options: {
      port: { type: 'string' },
      'allowed-origins': { type: 'string' },
      root: { type: 'string' },
      'api-url': { type: 'string' },
      'heartbeat-interval-ms': { type: 'string' },
      'warm-retention-sec': { type: 'string' },
      supervised: { type: 'boolean' },
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
  const root = values.root ?? resolveAgentServerRoot({ root: envConfig.root });
  const defaultApiUrl =
    values['api-url'] ?? (envConfig.apiUrl || DEFAULT_API_URL);
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
          const pairing = new PairingService();
          // Consumes MOLTNET_AGENT_SERVER_NATIVE_TOKEN from process.env, so
          // run children spawned later cannot inherit the desktop's token.
          const nativeClient = applyNativeClientGrant({
            pairing,
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
                'for browser pairing only.',
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
          const tls = isMacos() ? await ensureTrustedLocalTls(root) : undefined;
          const selfOrigin = `${tls ? 'https' : 'http'}://127.0.0.1:${port}`;
          const app = buildAgentServer({
            store,
            secrets,
            secretProviders,
            externalSecretProviders,
            pairing,
            runs,
            subscriptions,
            providers,
            runtimeRegistry,
            allowedOrigins,
            selfOrigin,
            ...(tls ? { tls: { key: tls.key, cert: tls.cert } } : {}),
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
            const address = await app.listen({ host: '127.0.0.1', port });
            console.error(`moltnet-agent server listening on ${address}`);
            console.error(`config root: ${root}`);
            console.error(`allowed origins: ${allowedOrigins.join(', ')}`);
            if (nativeClient) {
              console.error('native desktop client: authorized');
            }
            console.error(
              'Pair from the Console "Local runtime" page; approve the one-click prompt this server opens.',
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

interface TrustStatus {
  supported: boolean;
  trusted: boolean;
  fingerprint: string | null;
}

export async function runTrustCommand(
  argv: string[],
  defaultRoot: string,
): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        root: { type: 'string' },
        remove: { type: 'boolean' },
        status: { type: 'boolean' },
        yes: { type: 'boolean' },
        json: { type: 'boolean' },
      },
    });
    const root = values.root ?? defaultRoot;
    const statusRequested = Boolean(values.status);
    const removeRequested = Boolean(values.remove);
    const yes = Boolean(values.yes);
    const json = Boolean(values.json);
    if (statusRequested && (removeRequested || yes)) {
      console.error('Usage: moltnet-agent server trust --status [--json]');
      return 1;
    }
    if (!isMacos()) {
      if (json) {
        printTrustStatus({
          supported: false,
          trusted: false,
          fingerprint: null,
        });
        return 0;
      }
      console.error(
        'Local HTTPS trust setup is currently supported on macOS only.',
      );
      return 1;
    }

    const material = await ensureLocalTlsMaterial(root);
    if (statusRequested) {
      const trusted = await isLocalCaTrusted(root);
      if (json)
        printTrustStatus({
          supported: true,
          trusted,
          fingerprint: material.fingerprint,
        });
      else
        console.log(
          trusted
            ? `MoltNet local CA ${material.fingerprint} is trusted.`
            : `MoltNet local CA ${material.fingerprint} is not trusted.`,
        );
      return 0;
    }

    if (json && !yes) {
      console.error(
        'Machine-readable trust changes require --yes after native app consent.',
      );
      return 1;
    }

    if (removeRequested) {
      await removeLocalCa(root);
      if (json)
        printTrustStatus({
          supported: true,
          trusted: false,
          fingerprint: material.fingerprint,
        });
      else
        console.log('Removed the MoltNet local CA from your login keychain.');
      return 0;
    }

    if (yes) await trustLocalCa(root);
    else await ensureTrustedLocalTls(root);
    if (json)
      printTrustStatus({
        supported: true,
        trusted: await isLocalCaTrusted(root),
        fingerprint: material.fingerprint,
      });
    else console.log('MoltNet local HTTPS trust is ready for this macOS user.');
    return 0;
  } catch (cause) {
    console.error(
      `Agent Server trust command failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return 1;
  }
}

function printTrustStatus(status: TrustStatus): void {
  console.log(JSON.stringify(status));
}

async function ensureTrustedLocalTls(root: string) {
  const material = await ensureLocalTlsMaterial(root);
  if (await isLocalCaTrusted(root)) return material;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Local HTTPS trust is not configured. Run `moltnet-agent server trust` from an interactive terminal.',
    );
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(
      `Trust MoltNet's local CA (${material.fingerprint}) in this macOS login keychain? [y/N] `,
    );
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new Error('Local HTTPS trust was not approved.');
    }
  } finally {
    prompt.close();
  }
  await trustLocalCa(root);
  return material;
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
