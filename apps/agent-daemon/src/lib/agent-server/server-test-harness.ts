import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, type symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import {
  READ_ONLY_CAPABILITIES,
  resolveAgentKey,
  SecretProviderRegistry,
} from '@themoltnet/sdk';
import { type connect, FileSecretProvider } from '@themoltnet/sdk/node';
import type { FastifyInstance } from 'fastify';

import { ProviderConfigurationService } from '../provider-configuration.js';
import { type ActivatedAgent } from './identity.js';
import { NativeGrantService } from './native-grant-service.js';
import type { OperatorOAuth } from './operator-oauth.js';
import { ProviderLoginService } from './provider-login.js';
import { RunManager, type SpawnImpl } from './runs.js';
import { RuntimeRegistry } from './runtime-registry.js';
import type { BuildAgentServerOptions } from './server.js';
import { buildAgentServer } from './server.js';
import type { RunSpec } from './store.js';
import { AgentServerStore, AgentServerStoreError } from './store.js';
import {
  captureTeamCredential,
  verifyTeamActivation,
} from './team-credentials.js';

/**
 * Shared harness for the AgentServer HTTP suites.
 *
 * `fixture()` stands up a real Fastify instance over a temp store with a fake
 * spawn, so the suites exercise the actual routing, security profile and
 * serialization rather than a stub. It lives here because four suites need it
 * and a single file holding all four could not be reviewed as a diff.
 *
 * The `afterEach` below registers per importing test file: vitest isolates
 * modules per file, so each suite gets its own cleanup list.
 */

export const CONSOLE_ORIGIN = 'https://console.themolt.net';
export const HOST = '127.0.0.1:17374';

class FakeChild extends EventEmitter {
  pid = 4242;
  killed: string[] = [];
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill(signal?: string): boolean {
    this.killed.push(signal ?? 'SIGTERM');
    // Simulate prompt, clean exit on SIGTERM.
    setImmediate(() => {
      this.stdout.end();
      this.stderr.end();
      this.emit('exit', 0, signal ?? 'SIGTERM');
    });
    return true;
  }
}

export interface Fixture {
  app: FastifyInstance;
  store: AgentServerStore;
  secrets: FileSecretProvider;
  spawned: {
    command: string;
    args: readonly string[];
    options: { cwd: string; env: Record<string, string | undefined> };
  }[];
  children: FakeChild[];
}

const browserTokens = new WeakMap<FastifyInstance, string>();
const cleanups: (() => Promise<void> | void)[] = [];

/**
 * Tear something down after the current test.
 *
 * Exported rather than the array itself so a suite cannot reorder or drain
 * another suite's cleanups.
 */
export function registerCleanup(cleanup: () => Promise<void> | void): void {
  cleanups.push(cleanup);
}

/**
 * Run every registered cleanup. Each suite wires this into its own `afterEach`
 * rather than the harness installing a hook into files it does not own.
 */
export async function cleanupAll(): Promise<void> {
  for (const cleanup of cleanups.splice(0)) await cleanup();
}

export async function fixture(
  options: {
    rateLimitMax?: number;
    baseEnv?: NodeJS.ProcessEnv;
    maxLogBytes?: number;
    discoverFetch?: typeof fetch;
    symlinkImpl?: typeof symlinkSync;
    activeIdentity?: string;
    nativeGrant?: NativeGrantService;
    catalogueAgentFor?: BuildAgentServerOptions['catalogueAgentFor'];
    externalSecrets?: Record<string, string>;
    realCredentialPreflight?: boolean;
    resolveRuntimeModule?: (
      spec: RunSpec,
      agent: ActivatedAgent,
      cwd: string,
    ) => Promise<string | undefined>;
  } = {},
): Promise<Fixture> {
  const {
    baseEnv = { PATH: '/usr/bin' },
    maxLogBytes,
    symlinkImpl,
    resolveRuntimeModule,
    externalSecrets = {},
    realCredentialPreflight = false,
    ...serverOptions
  } = options;
  const temp = mkdtempSync(join(tmpdir(), 'agent-server-'));
  const store = new AgentServerStore(join(temp, 'moltnet')).ensure();
  const secrets = new FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
  const spawned: Fixture['spawned'] = [];
  const children: FakeChild[] = [];
  const secretProviders = new SecretProviderRegistry()
    .register(secrets)
    .register({
      name: 'memory',
      capabilities: READ_ONLY_CAPABILITIES,
      read: (key) =>
        Promise.resolve(
          key === 'provider/ollama' ? 'resolved-through-registry' : null,
        ),
      probe: (key) =>
        Promise.resolve(key === 'provider/ollama' ? 'present' : 'absent'),
    });
  const externalSecretProviders = new SecretProviderRegistry().register({
    name: 'memory',
    capabilities: READ_ONLY_CAPABILITIES,
    read: (key) => {
      const values: Record<string, string> = {
        'oauth2/agent-1/client': 'resolved-external-secret',
        'agent-key/agent-1': 'resolved-external-agent-key',
        'identity/FP-1/seed': 'resolved-central-seed',
        ...externalSecrets,
      };
      return Promise.resolve(values[key] ?? null);
    },
    probe: (key) =>
      Promise.resolve(
        Object.keys({
          'oauth2/agent-1/client': true,
          'agent-key/agent-1': true,
          'identity/FP-1/seed': true,
          ...externalSecrets,
        }).includes(key)
          ? 'present'
          : 'absent',
      ),
  });
  const spawnImpl: SpawnImpl = (command, args, options) => {
    const child = new FakeChild();
    spawned.push({ command, args, options });
    children.push(child);
    return child as unknown as ChildProcess;
  };
  const verifyActivation: typeof verifyTeamActivation = async (
    activationStore,
    alias,
    _managed,
    _external,
    _connect,
    _signal,
    teamId,
  ) => {
    const activation = activationStore.readActivation(alias);
    if (!activation) {
      throw new AgentServerStoreError(
        'not_found',
        `Agent alias '${alias}' is not activated`,
      );
    }
    const config =
      activation.source === 'managed'
        ? activationStore.readAgentConfig(alias)
        : (JSON.parse(
            readFileSync(activation.configPath, 'utf8'),
          ) as ReturnType<AgentServerStore['readAgentConfig']>);
    if (!config) {
      throw new AgentServerStoreError(
        'not_found',
        `Missing config for '${alias}'`,
      );
    }
    return Promise.resolve(
      captureTeamCredential(
        {
          activation,
          config,
          ...(activation.boundTeamId
            ? { boundTeamId: activation.boundTeamId }
            : {}),
        },
        {
          agentKey:
            activation.source === 'external'
              ? (await resolveAgentKey(
                  config,
                  externalSecretProviders,
                  teamId,
                ))!
              : `test-key-${teamId}`,
          metadata: {
            keyId: `key-${teamId}`,
            verifiedAt: new Date().toISOString(),
            scopes: [],
          },
          client: {} as Awaited<ReturnType<typeof connect>>,
        },
      ),
    );
  };
  const runs = new RunManager({
    store,
    secretProviders,
    externalSecretProviders,
    baseEnv,
    entrypoint: {
      execPath: '/usr/bin/node',
      execArgv: [],
      scriptPath: '/app/main.js',
    },
    spawnImpl,
    verifyActivationImpl: realCredentialPreflight
      ? verifyTeamActivation
      : verifyActivation,
    ...(realCredentialPreflight
      ? { runtimeRegistry: new RuntimeRegistry(store.root) }
      : {}),
    ...(symlinkImpl ? { symlinkImpl } : {}),
    ...(maxLogBytes === undefined ? {} : { maxLogBytes }),
    ...(resolveRuntimeModule ? { resolveRuntimeModule } : {}),
  });
  const browserToken = randomUUID();
  const app = buildAgentServer({
    operatorOAuth: {
      cancel: () => undefined,
      verifyBrowser: async (token: string) => {
        if (token !== browserToken) throw new Error('Invalid browser token');
      },
    } as unknown as OperatorOAuth,
    store,
    secrets,
    secretProviders,
    externalSecretProviders,
    nativeGrant: options.nativeGrant ?? new NativeGrantService(),
    ...(options.catalogueAgentFor
      ? { catalogueAgentFor: options.catalogueAgentFor }
      : {}),
    runs,
    subscriptions: new ProviderLoginService({
      authPath: store.piAuthJsonPath,
      listProviders: () => [],
      runLogin: () => Promise.resolve(),
      isConnected: () => false,
    }),
    providers: new ProviderConfigurationService({
      store,
      secrets,
      secretProviders,
      ...(serverOptions.discoverFetch
        ? { fetchImpl: serverOptions.discoverFetch }
        : {}),
    }),
    allowedOrigins: [CONSOLE_ORIGIN],
    selfOrigin: 'http://127.0.0.1:17374',
    defaultApiUrl: 'https://api.example',
    version: 'test',
    ...serverOptions,
  });
  browserTokens.set(app, browserToken);
  await app.ready();
  cleanups.push(async () => {
    await app.close();
    rmSync(temp, { recursive: true, force: true });
  });
  return { app, store, secrets, spawned, children };
}

export function activateManaged(
  store: AgentServerStore,
  boundTeamId?: string,
): void {
  store.writeAgentConfig('course-bot', {
    subject_id: 'agent-1',
    subject_type: 'agent',
    registered_at: 't',
    agent_key_ref: { provider: 'file', key: 'agent-key/agent-1' },
    keys: {
      public_key: 'pk',
      fingerprint: 'FP-1',
      private_key_ref: { provider: 'file', key: 'identity/FP-1/seed' },
    },
    endpoints: {
      api: 'https://api.example',
      mcp: 'https://mcp.example/mcp',
    },
  });
  store.writeActivation({
    source: 'managed',
    alias: 'course-bot',
    subjectId: 'agent-1',
    publicKey: 'pk',
    fingerprint: 'FP-1',
    ...(boundTeamId ? { boundTeamId } : {}),
    createdAt: 't',
    apiUrl: 'https://api.example',
  });
}

export function writeCentralIdentity(
  store: AgentServerStore,
  alias: string,
  hasAgentKey: boolean,
): void {
  store.writeAgentConfig(alias, {
    subject_id: `agent-${alias}`,
    subject_type: 'agent',
    registered_at: 't',
    ...(hasAgentKey
      ? {
          agent_key_ref: {
            provider: 'file' as const,
            key: `agent-key/${alias}`,
          },
        }
      : {
          oauth2: {
            client_id: `client-${alias}`,
            client_secret_ref: {
              provider: 'file' as const,
              key: `oauth2/agent-${alias}/client-${alias}`,
            },
          },
        }),
    keys: {
      public_key: `pk-${alias}`,
      fingerprint: `FP-${alias}`,
      private_key_ref: {
        provider: 'file' as const,
        key: `identity/FP-${alias}/seed`,
      },
    },
    endpoints: {
      api: 'https://api.example',
      mcp: 'https://mcp.example/mcp',
    },
  });
}

/** HTTP route tests inject verified OAuth; cryptographic checks live in operator-oauth tests. */
export async function authorize(app: FastifyInstance): Promise<string> {
  const token = browserTokens.get(app);
  if (!token) throw new Error('Missing browser authorization fixture');
  return token;
}
