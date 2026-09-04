/**
 * AgentServer HTTP surface tests: pairing ceremony, paired-token gating, provider
 * registry (presence booleans only), and run lifecycle against a fake spawn.
 */
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  type symlinkSync,
  writeFileSync,
} from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import {
  READ_ONLY_CAPABILITIES,
  SecretProviderRegistry,
} from '@themoltnet/sdk';
import { FileSecretProvider } from '@themoltnet/sdk/node';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActivatedAgent, verifyAgentActivation } from './identity.js';
import { PairingService } from './pairing.js';
import { ProviderLoginService } from './provider-login.js';
import { RunManager, type SpawnImpl } from './runs.js';
import {
  AGENT_SERVER_TOKEN_HEADER,
  buildAgentServer,
  readAgentServerLogDelta,
} from './server.js';
import type { RunSpec } from './store.js';
import { AgentServerStore, AgentServerStoreError } from './store.js';

const CONSOLE_ORIGIN = 'https://console.themolt.net';
const HOST = '127.0.0.1:17374';

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

interface Fixture {
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

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(
  options: {
    rateLimitMax?: number;
    baseEnv?: NodeJS.ProcessEnv;
    maxLogBytes?: number;
    discoverFetch?: typeof fetch;
    symlinkImpl?: typeof symlinkSync;
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
    read: (key) =>
      Promise.resolve(
        key === 'oauth2/external-id/client' ? 'resolved-external-secret' : null,
      ),
    probe: (key) =>
      Promise.resolve(
        key === 'oauth2/external-id/client' ? 'present' : 'absent',
      ),
  });
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
    return Promise.resolve({
      activation,
      config,
      ...(activation.boundTeamId
        ? { boundTeamId: activation.boundTeamId }
        : {}),
    });
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
    verifyActivationImpl: verifyActivation,
    ...(symlinkImpl ? { symlinkImpl } : {}),
    ...(maxLogBytes === undefined ? {} : { maxLogBytes }),
    ...(resolveRuntimeModule ? { resolveRuntimeModule } : {}),
  });
  const app = buildAgentServer({
    store,
    secrets,
    secretProviders,
    externalSecretProviders,
    pairing: new PairingService(),
    runs,
    subscriptions: new ProviderLoginService({
      authPath: store.piAuthJsonPath,
      listProviders: () => [],
      runLogin: () => Promise.resolve(),
      isConnected: () => false,
    }),
    allowedOrigins: [CONSOLE_ORIGIN],
    selfOrigin: 'http://127.0.0.1:17374',
    defaultApiUrl: 'https://api.example',
    version: 'test',
    ...serverOptions,
  });
  await app.ready();
  cleanups.push(async () => {
    await app.close();
    rmSync(temp, { recursive: true, force: true });
  });
  return { app, store, secrets, spawned, children };
}

function activateManaged(store: AgentServerStore, boundTeamId?: string): void {
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
    ...(boundTeamId ? { boundTeamId } : {}),
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

describe('agent server pairing', () => {
  it('invalidates grants when the supervisor process changes', () => {
    const firstProcess = new PairingService();
    const { pairingId } = firstProcess.start(CONSOLE_ORIGIN);
    const { confirmToken } = firstProcess.approval(pairingId);
    firstProcess.confirm(pairingId, confirmToken);
    const { token } = firstProcess.claim(pairingId, CONSOLE_ORIGIN);

    expect(() => firstProcess.verify(CONSOLE_ORIGIN, token)).not.toThrow();
    expect(() => new PairingService().verify(CONSOLE_ORIGIN, token)).toThrow(
      'not valid for this origin',
    );
  });

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
        [AGENT_SERVER_TOKEN_HEADER]: token,
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
        [AGENT_SERVER_TOKEN_HEADER]: 'forged',
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

describe('agent server providers and runs', () => {
  it('caps log replay without dropping lines appended across polls', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agent-server-log-tail-'));
    cleanups.push(() => rmSync(temp, { recursive: true, force: true }));
    const logPath = join(temp, 'run.log');
    const state = { offset: 0, fragment: '' };
    writeFileSync(logPath, 'discarded\nkept\n');

    let handle = await open(logPath, 'r');
    const replay = await readAgentServerLogDelta(handle, state, 8);
    await handle.close();
    expect(replay).toEqual({ lines: ['kept'], omitted: true });

    writeFileSync(logPath, 'partial', { flag: 'a' });
    handle = await open(logPath, 'r');
    const partial = await readAgentServerLogDelta(handle, state, 32);
    await handle.close();
    expect(partial).toEqual({ lines: [], omitted: false });

    writeFileSync(logPath, ' line\nnext\n', { flag: 'a' });
    handle = await open(logPath, 'r');
    const appended = await readAgentServerLogDelta(handle, state, 32);
    await handle.close();
    expect(appended).toEqual({
      lines: ['partial line', 'next'],
      omitted: false,
    });

    const longLineState = { offset: 0, fragment: '' };
    writeFileSync(logPath, '1234');
    handle = await open(logPath, 'r');
    expect(
      await readAgentServerLogDelta(handle, longLineState, 8),
    ).toMatchObject({
      omitted: false,
    });
    await handle.close();
    writeFileSync(logPath, '56789', { flag: 'a' });
    handle = await open(logPath, 'r');
    expect(await readAgentServerLogDelta(handle, longLineState, 8)).toEqual({
      lines: [],
      omitted: true,
    });
    await handle.close();
    expect(longLineState.fragment).toBe('');

    const unicode = Buffer.from('🦞\n');
    const unicodeState = { offset: 0, fragment: '' };
    writeFileSync(logPath, unicode.subarray(0, 2));
    handle = await open(logPath, 'r');
    expect(
      await readAgentServerLogDelta(handle, unicodeState, 32),
    ).toMatchObject({
      lines: [],
    });
    await handle.close();
    writeFileSync(logPath, unicode.subarray(2), { flag: 'a' });
    handle = await open(logPath, 'r');
    expect(
      await readAgentServerLogDelta(handle, unicodeState, 32),
    ).toMatchObject({
      lines: ['🦞'],
    });
    await handle.close();
  });

  it('consumes a bounded log delta across short file reads', async () => {
    const contents = Buffer.from('first\nsecond\n');
    const handle = {
      stat: () =>
        Promise.resolve({ isFile: () => true, size: contents.length }),
      read: (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number | null,
      ) => {
        const start = position ?? 0;
        const bytesRead = Math.min(length, 3, contents.length - start);
        contents.copy(buffer, offset, start, start + bytesRead);
        return Promise.resolve({ bytesRead, buffer });
      },
    } as unknown as FileHandle;

    await expect(
      readAgentServerLogDelta(handle, { offset: 0, fragment: '' }, 32),
    ).resolves.toEqual({
      lines: ['first', 'second'],
      omitted: false,
    });
  });

  it('bounds the run history returned by the polled status surface', async () => {
    const { app, store } = await fixture();
    const token = await pair(app);
    activateManaged(store);
    const activeResponse = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: {
        agent: 'course-bot',
        teamId: 'team',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    const activeId = activeResponse.json<{ id: string }>().id;
    for (let index = 0; index < 105; index += 1) {
      const id = `z-history-${String(index).padStart(3, '0')}`;
      store.createRunDir(id);
      store.writeRun({
        id,
        agent: 'agent',
        teamId: 'team',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
        status: 'exited',
        startedAt: new Date(index * 1_000).toISOString(),
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    expect(response.statusCode).toBe(200);
    const runs = response.json<{ runs: { id: string; active: boolean }[] }>()
      .runs;
    expect(runs).toHaveLength(101);
    expect(runs).toContainEqual(
      expect.objectContaining({ id: activeId, active: true }),
    );
  });

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
        [AGENT_SERVER_TOKEN_HEADER]: token,
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
      [AGENT_SERVER_TOKEN_HEADER]: token,
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
    expect(existsSync(join(store.secretsDir, 'pi-provider', 'ollama'))).toBe(
      false,
    );
  });

  it('removes a provider and its local API key', async () => {
    const { app, store } = await fixture();
    const token = await pair(app);
    const headers = {
      host: HOST,
      origin: CONSOLE_ORIGIN,
      [AGENT_SERVER_TOKEN_HEADER]: token,
      'content-type': 'application/json',
    };
    await app.inject({
      method: 'PUT',
      url: '/v1/providers/ollama',
      headers,
      payload: {
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        models: ['qwen3-coder:480b-cloud'],
        apiKey: 'remove-me',
      },
    });

    const removed = await app.inject({
      method: 'DELETE',
      url: '/v1/providers/ollama',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    expect(removed.statusCode).toBe(204);
    expect(store.readProviders().ollama).toBeUndefined();
    expect(existsSync(join(store.secretsDir, 'pi-provider/ollama'))).toBe(
      false,
    );
  });

  it('serializes provider updates so concurrent writes cannot drop entries', async () => {
    const { app, store, secrets } = await fixture();
    const token = await pair(app);
    const headers = {
      host: HOST,
      origin: CONSOLE_ORIGIN,
      [AGENT_SERVER_TOKEN_HEADER]: token,
      'content-type': 'application/json',
    };
    const originalWrite = secrets.write.bind(secrets);
    let firstStarted!: () => void;
    let releaseFirst!: () => void;
    const started = new Promise<void>((resolvePromise) => {
      firstStarted = resolvePromise;
    });
    const release = new Promise<void>((resolvePromise) => {
      releaseFirst = resolvePromise;
    });
    vi.spyOn(secrets, 'write').mockImplementation(async (key, value) => {
      if (key === 'pi-provider/first') {
        firstStarted();
        await release;
      }
      await originalWrite(key, value);
    });
    const payload = (id: string) => ({
      api: 'openai-completions',
      baseUrl: `https://${id}.example/v1`,
      envName: `MOLTNET_PROVIDER_${id.toUpperCase()}_API_KEY`,
      models: ['model'],
      apiKey: `${id}-secret`,
    });

    const first = app.inject({
      method: 'PUT',
      url: '/v1/providers/first',
      headers,
      payload: payload('first'),
    });
    await started;
    const second = app.inject({
      method: 'PUT',
      url: '/v1/providers/second',
      headers,
      payload: payload('second'),
    });
    releaseFirst();
    const responses = await Promise.all([first, second]);

    expect(responses.every((response) => response.statusCode === 200)).toBe(
      true,
    );
    expect(Object.keys(store.readProviders()).sort()).toEqual([
      'first',
      'second',
    ]);
  });

  it('uses only the locally resolved runtime module for a Console run', async () => {
    const localRuntime = 'file:///opt/moltnet/runtimes/acme-review.mjs';
    const resolveRuntimeModule = vi.fn(async () => localRuntime);
    const { app, store, spawned } = await fixture({ resolveRuntimeModule });
    const token = await pair(app);
    activateManaged(store);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: {
        agent: 'course-bot',
        teamId: 'team-1',
        profiles: ['review-profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
        runtime: 'https://attacker.example/runtime.mjs',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(resolveRuntimeModule).toHaveBeenCalledWith(
      expect.objectContaining({ profiles: ['review-profile'] }),
      expect.any(Object),
      expect.any(String),
    );
    expect(spawned[0]?.args).toEqual(
      expect.arrayContaining(['--runtime', localRuntime]),
    );
    expect(spawned[0]?.args).not.toContain(
      'https://attacker.example/runtime.mjs',
    );
  });

  it('starts and stops a run for a managed agent with resolved provider env', async () => {
    const { app, store, spawned, children } = await fixture();
    const token = await pair(app);
    const headers = {
      host: HOST,
      origin: CONSOLE_ORIGIN,
      [AGENT_SERVER_TOKEN_HEADER]: token,
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
    expect(created.json()).toHaveProperty('active', true);

    const duplicate = await app.inject({
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
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json()).toHaveProperty('active', true);
    expect(duplicate.json<{ id: string }>().id).not.toBe(run.id);

    expect(spawned).toHaveLength(2);
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
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });
    expect(stopped.statusCode).toBe(200);
    expect(children[0].killed).toContain('SIGTERM');
    await new Promise((resolvePromise) => {
      setImmediate(() => resolvePromise(undefined));
    });
    expect(store.readRun(run.id)?.status).toBe('stopped');
  });

  it('refuses managed-agent creation without an enrollment token', async () => {
    const { app } = await fixture();
    const token = await pair(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: { kind: 'managed', name: 'orphan-bot' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ message: string }>().message).toContain(
      'enrollmentToken',
    );
  });

  it('rejects a managed registration API override before forwarding its enrollment token', async () => {
    const { app } = await fixture();
    const token = await pair(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: {
        kind: 'managed',
        name: 'egress-bot',
        enrollmentToken: 'single-use-secret',
        apiUrl: 'https://attacker.example',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_body' });
    expect(response.body).not.toContain('single-use-secret');
  });

  it('exposes the pinned team binding and rejects cross-team run starts', async () => {
    const { app, store, spawned } = await fixture();
    const token = await pair(app);
    activateManaged(store, 'team-bound');
    const headers = {
      host: HOST,
      origin: CONSOLE_ORIGIN,
      [AGENT_SERVER_TOKEN_HEADER]: token,
      'content-type': 'application/json',
    };

    const agents = await app.inject({
      method: 'GET',
      url: '/v1/agents',
      headers,
    });
    expect(agents.json()).toEqual([
      expect.objectContaining({
        agentName: 'course-bot',
        teamId: 'team-bound',
      }),
    ]);

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers,
      payload: {
        agent: 'course-bot',
        teamId: 'team-other',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json<{ message: string }>().message).toContain(
      'bound to team team-bound',
    );
    expect(spawned).toHaveLength(0);

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers,
      payload: {
        agent: 'course-bot',
        teamId: 'team-bound',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    expect(accepted.statusCode).toBe(201);
    expect(spawned).toHaveLength(1);
  });

  it('fails run startup when subscription credentials cannot be linked', async () => {
    const { app, store, spawned } = await fixture({
      symlinkImpl: () => {
        throw Object.assign(new Error('symlinks unavailable'), {
          code: 'EPERM',
        });
      },
    });
    const token = await pair(app);
    activateManaged(store);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: {
        agent: 'course-bot',
        teamId: 'team-1',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      code: 'io_error',
      message: 'could not link subscription credentials into the run',
    });
    expect(spawned).toHaveLength(0);
    expect(readdirSync(store.runsDir)).toEqual([]);
  });

  it('does not leak ambient supervisor credentials into run children', async () => {
    const { app, store, spawned } = await fixture({
      baseEnv: {
        PATH: '/usr/bin',
        HOME: '/tmp/home',
        SSH_AUTH_SOCK: '/tmp/agent.sock',
        KUBECONFIG: '/tmp/kubeconfig',
        DOCKER_CONFIG: '/tmp/docker',
        MOLTNET_GIT_AUTHOR: 'Agent <agent@example.test>',
        MOLTNET_OTEL_ENDPOINT: 'http://127.0.0.1:4318',
        MOLTNET_AGENT_KEY: 'ambient-agent-key',
        MOLTNET_CLIENT_SECRET: 'ambient-client-secret',
        MOLTNET_PRIVATE_KEY: 'ambient-private-key',
        GITHUB_TOKEN: 'ambient-github-token',
        ANTHROPIC_API_KEY: 'ambient-provider-key',
        DATABASE_URL: 'postgres://user:password@database.example/db',
        PI_AUTH_JSON: '{"provider":"ambient"}',
      },
    });
    const token = await pair(app);
    activateManaged(store);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: {
        agent: 'course-bot',
        teamId: 'team-1',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });

    expect(response.statusCode).toBe(201);
    const childEnv = spawned[0]?.options.env ?? {};
    expect(childEnv).toMatchObject({
      PATH: '/usr/bin',
      MOLTNET_GIT_AUTHOR: 'Agent <agent@example.test>',
      MOLTNET_OTEL_ENDPOINT: 'http://127.0.0.1:4318',
    });
    expect(childEnv.HOME).not.toBe('/tmp/home');
    expect(childEnv.HOME).toMatch(/\/runs\/[^/]+\/home$/u);
    expect(childEnv).not.toHaveProperty('SSH_AUTH_SOCK');
    expect(childEnv).not.toHaveProperty('KUBECONFIG');
    expect(childEnv).not.toHaveProperty('DOCKER_CONFIG');
    expect(childEnv).not.toHaveProperty('MOLTNET_AGENT_KEY');
    expect(childEnv).not.toHaveProperty('MOLTNET_CLIENT_SECRET');
    expect(childEnv).not.toHaveProperty('MOLTNET_PRIVATE_KEY');
    expect(childEnv).not.toHaveProperty('GITHUB_TOKEN');
    expect(childEnv).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(childEnv).not.toHaveProperty('DATABASE_URL');
    expect(childEnv).not.toHaveProperty('PI_AUTH_JSON');
    expect(childEnv['MOLTNET_AGENT_KEY_REF']).toBe('file:agent-key/id-1');
  });

  it('caps active child logs at the configured byte budget', async () => {
    const { app, store, children } = await fixture({ maxLogBytes: 32 });
    const token = await pair(app);
    activateManaged(store);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: {
        agent: 'course-bot',
        teamId: 'team-1',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    const { id } = created.json<{ id: string }>();
    children[0]?.stdout.write('x'.repeat(128));
    children[0]?.kill('SIGTERM');
    await vi.waitFor(() => {
      expect(
        readFileSync(join(store.runDir(id), 'daemon.log'), 'utf8'),
      ).toContain('[truncated]');
      expect(
        readFileSync(join(store.runDir(id), 'daemon.log')).byteLength,
      ).toBeLessThanOrEqual(32);
    });
  });

  it('reconciles persisted running records when a supervisor is replaced', async () => {
    const { store } = await fixture();
    store.createRunDir('interrupted');
    store.writeRun({
      id: 'interrupted',
      agent: 'course-bot',
      teamId: 'team-1',
      profiles: ['profile'],
      taskTypes: ['freeform'],
      mode: 'poll',
      status: 'running',
      pid: 1234,
      startedAt: '2026-01-01T00:00:00Z',
    });
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    new RunManager({
      store,
      secretProviders: new SecretProviderRegistry(),
      externalSecretProviders: new SecretProviderRegistry(),
      baseEnv: {},
      logger,
      now: () => new Date('2026-01-02T00:00:00Z'),
    });

    expect(store.readRun('interrupted')).toMatchObject({
      status: 'failed',
      exitCode: null,
      endedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'interrupted',
        pid: 1234,
        transition: 'interrupted',
      }),
      'agent server run interrupted by supervisor replacement',
    );
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
        oauth2: {
          client_id: 'client',
          client_secret_ref: {
            provider: 'memory',
            key: 'oauth2/external-id/client',
          },
        },
        keys: {
          public_key: 'pk',
          private_key: 'seed',
          fingerprint: 'fp',
        },
        endpoints: {
          api: 'http://127.0.0.1:4000',
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
      configApiUrl: 'http://127.0.0.1:4000',
      apiUrl: 'http://127.0.0.1:4000',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
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
    expect(spawned[0]?.options.env['MOLTNET_CLIENT_ID']).toBe('client');
    expect(spawned[0]?.options.env['MOLTNET_CLIENT_SECRET']).toBe(
      'resolved-external-secret',
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
      [AGENT_SERVER_TOKEN_HEADER]: token,
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
        [AGENT_SERVER_TOKEN_HEADER]: token,
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
        [AGENT_SERVER_TOKEN_HEADER]: token,
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
    expect(response.json()).toEqual({
      code: 'internal_error',
      message: 'The local supervisor could not complete the request.',
    });
    expect(response.body).not.toContain('disk full');
    expect(spawned).toHaveLength(1);
    expect(children[0]?.killed).toContain('SIGKILL');
    expect(readdirSync(store.runsDir)).toEqual([]);
  });
});
