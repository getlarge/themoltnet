/**
 * Serve HTTP surface tests: pairing ceremony, paired-token gating, provider
 * registry (presence booleans only), and run lifecycle against a fake spawn.
 */
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  READ_ONLY_CAPABILITIES,
  SecretProviderRegistry,
} from '@themoltnet/sdk';
import { FileSecretProvider } from '@themoltnet/sdk/node';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { verifyAgentActivation } from './identity.js';
import { PairingService } from './pairing.js';
import { RunManager, type SpawnImpl } from './runs.js';
import { buildServeServer, SERVE_TOKEN_HEADER } from './server.js';
import { ServeStore, ServeStoreError } from './store.js';

const CONSOLE_ORIGIN = 'https://console.themolt.net';
const HOST = '127.0.0.1:17374';

class FakeChild extends EventEmitter {
  pid = 4242;
  killed: string[] = [];
  stdout = null;
  stderr = null;
  kill(signal?: string): boolean {
    this.killed.push(signal ?? 'SIGTERM');
    // Simulate prompt, clean exit on SIGTERM.
    setImmediate(() => this.emit('exit', 0));
    return true;
  }
}

interface Fixture {
  app: FastifyInstance;
  store: ServeStore;
  spawned: {
    command: string;
    args: readonly string[];
    options: { cwd: string; env: Record<string, string | undefined> };
  }[];
  children: FakeChild[];
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(
  options: { rateLimitMax?: number } = {},
): Promise<Fixture> {
  const temp = mkdtempSync(join(tmpdir(), 'serve-server-'));
  const store = new ServeStore(join(temp, 'moltnet')).ensure();
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
  const externalSecretProviders = new SecretProviderRegistry();
  const spawnImpl: SpawnImpl = (command, args, options) => {
    const child = new FakeChild();
    spawned.push({ command, args, options });
    children.push(child);
    return child as unknown as ChildProcess;
  };
  const verifyActivation: typeof verifyAgentActivation = (
    activationStore,
    alias,
  ) => {
    const activation = activationStore.readActivation(alias);
    if (!activation) {
      throw new ServeStoreError(
        'not_found',
        `Agent alias '${alias}' is not activated`,
      );
    }
    const config =
      activation.source === 'managed'
        ? activationStore.readAgentConfig(alias)
        : (JSON.parse(
            readFileSync(activation.configPath, 'utf8'),
          ) as ReturnType<ServeStore['readAgentConfig']>);
    if (!config) {
      throw new ServeStoreError('not_found', `Missing config for '${alias}'`);
    }
    return Promise.resolve({ activation, config });
  };
  const runs = new RunManager({
    store,
    secretProviders,
    externalSecretProviders,
    baseEnv: { PATH: '/usr/bin' },
    entrypoint: {
      execPath: '/usr/bin/node',
      execArgv: [],
      scriptPath: '/app/main.js',
    },
    spawnImpl,
    verifyActivationImpl: verifyActivation,
  });
  const app = buildServeServer({
    store,
    secrets,
    externalSecretProviders,
    pairing: new PairingService(store),
    runs,
    allowedOrigins: [CONSOLE_ORIGIN],
    selfOrigin: 'http://127.0.0.1:17374',
    defaultApiUrl: 'https://api.example',
    version: 'test',
    ...options,
  });
  await app.ready();
  cleanups.push(async () => {
    await app.close();
    rmSync(temp, { recursive: true, force: true });
  });
  return { app, store, spawned, children };
}

function activateManaged(store: ServeStore): void {
  store.writeAgentConfig('course-bot', {
    identity_id: 'id-1',
    registered_at: 't',
    agent_key_ref: { provider: 'file', key: 'agent-key/id-1' },
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
    identityId: 'id-1',
    publicKey: 'pk',
    fingerprint: 'FP-1',
    createdAt: 't',
    apiUrl: 'https://api.example',
  });
}

async function pair(app: FastifyInstance): Promise<string> {
  const started = await app.inject({
    method: 'POST',
    url: '/v1/pairings',
    headers: { host: HOST, origin: CONSOLE_ORIGIN },
  });
  expect(started.statusCode).toBe(201);
  const { pairingId } = started.json<{ pairingId: string }>();

  const approval = await app.inject({
    method: 'GET',
    url: `/pairings/${pairingId}`,
    headers: {
      host: HOST,
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    },
  });
  expect(approval.statusCode).toBe(200);
  expect(approval.body).toContain(CONSOLE_ORIGIN);
  const confirmToken = approval.body.match(
    /name="confirmToken" value="([^"]+)"/u,
  )?.[1];
  expect(confirmToken).toBeDefined();

  const confirmed = await app.inject({
    method: 'POST',
    url: `/pairings/${pairingId}/confirm`,
    headers: {
      host: HOST,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: new URLSearchParams({
      confirmToken: confirmToken ?? '',
    }).toString(),
  });
  expect(confirmed.statusCode).toBe(200);

  const claimed = await app.inject({
    method: 'POST',
    url: `/v1/pairings/${pairingId}/claim`,
    headers: { host: HOST, origin: CONSOLE_ORIGIN },
  });
  expect(claimed.statusCode).toBe(200);
  return claimed.json<{ token: string }>().token;
}

describe('serve pairing', () => {
  it('completes the one-click ceremony and gates /v1 on the token', async () => {
    const { app } = await fixture();

    const unpaired = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: { host: HOST, origin: CONSOLE_ORIGIN },
    });
    expect(unpaired.statusCode).toBe(401);

    const token = await pair(app);
    const status = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [SERVE_TOKEN_HEADER]: token,
      },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ version: 'test', runs: [] });

    const wrongToken = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [SERVE_TOKEN_HEADER]: 'forged',
      },
    });
    expect(wrongToken.statusCode).toBe(401);
  });

  it('rate-limits the loopback HTTP surface with stable errors', async () => {
    const { app } = await fixture({ rateLimitMax: 1 });
    const headers = {
      host: HOST,
      origin: CONSOLE_ORIGIN,
    };

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/pairings',
      headers,
    });
    const limited = await app.inject({
      method: 'POST',
      url: '/v1/pairings',
      headers,
    });

    expect(allowed.statusCode).toBe(201);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      code: 'rate_limited',
      message: 'Too many requests',
    });
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('rejects claims from a different origin and cross-site confirms', async () => {
    const { app } = await fixture();
    const started = await app.inject({
      method: 'POST',
      url: '/v1/pairings',
      headers: { host: HOST, origin: CONSOLE_ORIGIN },
    });
    const { pairingId } = started.json<{ pairingId: string }>();

    const crossSite = await app.inject({
      method: 'POST',
      url: `/pairings/${pairingId}/confirm`,
      headers: {
        host: HOST,
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'cross-site',
      },
      payload: 'confirmToken=x',
    });
    expect(crossSite.statusCode).toBe(400);

    const foreignClaim = await app.inject({
      method: 'POST',
      url: `/v1/pairings/${pairingId}/claim`,
      headers: { host: HOST, origin: 'http://127.0.0.1:17374' },
    });
    expect([401, 403]).toContain(foreignClaim.statusCode);
  });
});

describe('serve providers and runs', () => {
  it.each([
    'MOLTNET_API_URL',
    'NODE_OPTIONS',
    'PI_CODING_AGENT_DIR',
    '9INVALID',
    'HAS-HYPHEN',
  ])('rejects unsafe provider env name %s', async (envName) => {
    const { app } = await fixture();
    const token = await pair(app);
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/providers/unsafe',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [SERVE_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: {
        api: 'openai-completions',
        baseUrl: 'https://example.test/v1',
        envName,
        models: ['model'],
        apiKey: 'not-written',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_state' });
  });

  it('stores providers with secret refs and reports presence booleans only', async () => {
    const { app, store } = await fixture();
    const token = await pair(app);
    const headers = {
      host: HOST,
      origin: CONSOLE_ORIGIN,
      [SERVE_TOKEN_HEADER]: token,
      'content-type': 'application/json',
    };

    const put = await app.inject({
      method: 'PUT',
      url: '/v1/providers/ollama',
      headers,
      payload: {
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: ['qwen3-coder:480b-cloud'],
        apiKey: 'super-secret-value',
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      api: 'openai-completions',
      baseUrl: 'https://ollama.com/v1',
      envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
      models: ['qwen3-coder:480b-cloud'],
      hasApiKey: true,
    });

    // The value never lands in providers.json — only the file: ref.
    const providersRaw = readFileSync(
      join(store.root, 'providers.json'),
      'utf8',
    );
    expect(providersRaw).not.toContain('super-secret-value');
    expect(providersRaw).toContain('file:pi-provider/ollama');
    expect(
      readFileSync(join(store.secretsDir, 'pi-provider/ollama'), 'utf8'),
    ).toBe('super-secret-value');

    // Update without apiKey keeps the stored secret ref.
    const update = await app.inject({
      method: 'PUT',
      url: '/v1/providers/ollama',
      headers,
      payload: {
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: ['qwen3-coder:480b-cloud', 'gpt-oss:120b'],
      },
    });
    expect(update.json()).toMatchObject({ hasApiKey: true });

    const redirect = await app.inject({
      method: 'PUT',
      url: '/v1/providers/ollama',
      headers,
      payload: {
        api: 'openai-completions',
        baseUrl: 'https://attacker.example/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: ['qwen3-coder:480b-cloud'],
      },
    });
    expect(redirect.json()).toMatchObject({ hasApiKey: false });
    expect(store.readProviders().ollama.apiKeyRef).toBeUndefined();
  });

  it('starts and stops a run for a managed agent with resolved provider env', async () => {
    const { app, store, spawned, children } = await fixture();
    const token = await pair(app);
    const headers = {
      host: HOST,
      origin: CONSOLE_ORIGIN,
      [SERVE_TOKEN_HEADER]: token,
      'content-type': 'application/json',
    };

    activateManaged(store);
    await app.inject({
      method: 'PUT',
      url: '/v1/providers/ollama',
      headers,
      payload: {
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: ['qwen3-coder:480b-cloud'],
        apiKey: 'resolved-at-spawn',
      },
    });
    const providers = store.readProviders();
    providers.ollama.apiKeyRef = 'memory:provider/ollama';
    store.writeProviders(providers);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers,
      payload: {
        agent: 'course-bot',
        teamId: 'team-1',
        profiles: ['course-profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    expect(created.statusCode).toBe(201);
    const run = created.json<{ id: string; status: string }>();
    expect(run.status).toBe('running');

    expect(spawned).toHaveLength(1);
    const [{ command, args, options }] = spawned;
    expect(command).toBe('/usr/bin/node');
    expect(args).toEqual([
      '/app/main.js',
      'poll',
      '--agent',
      'course-bot',
      '--team',
      'team-1',
      '--profile',
      'course-profile',
      '--task-types',
      'freeform',
    ]);
    expect(options.env['MOLTNET_AGENT_KEY_REF']).toBe('file:agent-key/id-1');
    expect(options.env['MOLTNET_PRIVATE_KEY_REF']).toBe(
      'file:identity/FP-1/seed',
    );
    expect(options.env['MOLTNET_SECRET_ROOT']).toBe(store.secretsDir);
    expect(options.env['MOLTNET_EXPECTED_IDENTITY_ID']).toBe('id-1');
    expect(options.env['MOLTNET_EXPECTED_PUBLIC_KEY']).toBe('pk');
    expect(options.env['MOLTNET_EXPECTED_FINGERPRINT']).toBe('FP-1');
    expect(options.env['MOLTNET_PROVIDER_OLLAMA_API_KEY']).toBe(
      'resolved-through-registry',
    );
    expect(options.env['PI_CODING_AGENT_DIR']).toContain(run.id);

    // Generated models.json references the env var, never the value.
    const modelsRaw = readFileSync(
      join(store.runDir(run.id), 'pi', 'models.json'),
      'utf8',
    );
    expect(modelsRaw).toContain('"$MOLTNET_PROVIDER_OLLAMA_API_KEY"');
    expect(modelsRaw).not.toContain('resolved-through-registry');

    // No content-type: a body-less DELETE must not claim a JSON body (the
    // strict parser rejects empty bodies that do).
    const stopped = await app.inject({
      method: 'DELETE',
      url: `/v1/runs/${run.id}`,
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [SERVE_TOKEN_HEADER]: token,
      },
    });
    expect(stopped.statusCode).toBe(200);
    expect(children[0].killed).toContain('SIGTERM');
    await new Promise((resolvePromise) => {
      setImmediate(() => resolvePromise(undefined));
    });
    expect(store.readRun(run.id)?.status).toBe('stopped');
  });

  it('launches an external alias from the exact configured agent directory', async () => {
    const { app, store, spawned } = await fixture();
    const token = await pair(app);
    const agentRoot = join(store.root, 'external-root');
    const configDir = join(agentRoot, '.moltnet', 'configured-name');
    const configPath = join(configDir, 'moltnet.json');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        identity_id: 'external-id',
        registered_at: 't',
        oauth2: { client_id: 'client', client_secret: 'secret' },
        keys: {
          public_key: 'pk',
          private_key: 'seed',
          fingerprint: 'fp',
        },
        endpoints: {
          api: 'https://api.themolt.net',
          mcp: 'https://mcp.themolt.net/mcp',
        },
      }),
    );
    store.writeActivation({
      source: 'external',
      alias: 'console-alias',
      identityId: 'external-id',
      publicKey: 'pk',
      fingerprint: 'fp',
      createdAt: 't',
      configPath,
      configApiUrl: 'https://api.themolt.net',
      apiUrl: 'http://127.0.0.1:4000',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [SERVE_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: {
        agent: 'console-alias',
        teamId: 'team-1',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(spawned[0]?.args).toContain('configured-name');
    expect(spawned[0]?.args).toContain(agentRoot);
    expect(spawned[0]?.options.env['MOLTNET_API_URL']).toBe(
      'http://127.0.0.1:4000',
    );
    expect(spawned[0]?.options.env['MOLTNET_EXPECTED_IDENTITY_ID']).toBe(
      'external-id',
    );
    expect(spawned[0]?.options.env['MOLTNET_EXPECTED_PUBLIC_KEY']).toBe('pk');
    expect(spawned[0]?.options.env['MOLTNET_EXPECTED_FINGERPRINT']).toBe('fp');
  });

  it('rejects runs for unknown agents and invalid specs', async () => {
    const { app } = await fixture();
    const token = await pair(app);
    const headers = {
      host: HOST,
      origin: CONSOLE_ORIGIN,
      [SERVE_TOKEN_HEADER]: token,
      'content-type': 'application/json',
    };
    const unknownAgent = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers,
      payload: {
        agent: 'ghost',
        teamId: 'team-1',
        profiles: ['p'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    expect(unknownAgent.statusCode).toBe(404);

    const badMode = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers,
      payload: {
        agent: 'ghost',
        teamId: 'team-1',
        profiles: ['p'],
        taskTypes: ['freeform'],
        mode: 'watch',
      },
    });
    expect(badMode.statusCode).toBe(400);
  });

  it('does not materialize a run when provider resolution fails', async () => {
    const { app, store, spawned } = await fixture();
    const token = await pair(app);
    activateManaged(store);
    store.writeProviders({
      missing: {
        api: 'openai-completions',
        baseUrl: 'https://api.example/v1',
        envName: 'MOLTNET_PROVIDER_MISSING_API_KEY',
        models: ['model'],
        apiKeyRef: 'memory:missing',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [SERVE_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: {
        agent: 'course-bot',
        teamId: 'team-1',
        profiles: ['p'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(spawned).toHaveLength(0);
    expect(readdirSync(store.runsDir)).toEqual([]);
  });

  it('kills the child and removes artifacts when run persistence fails', async () => {
    const { app, store, spawned, children } = await fixture();
    const token = await pair(app);
    activateManaged(store);
    vi.spyOn(store, 'writeRun').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [SERVE_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: {
        agent: 'course-bot',
        teamId: 'team-1',
        profiles: ['p'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(spawned).toHaveLength(1);
    expect(children[0]?.killed).toContain('SIGKILL');
    expect(readdirSync(store.runsDir)).toEqual([]);
  });
});
