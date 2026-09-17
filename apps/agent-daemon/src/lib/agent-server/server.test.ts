/**
 * AgentServer provider registry (presence booleans only) and run lifecycle
 * against a fake spawn.
 *
 * Pairing, the native client and the catalogue have their own files; the shared
 * harness lives in `server-test-harness.ts`.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cryptoService } from '@moltnet/crypto-service';
import { SecretProviderRegistry } from '@themoltnet/sdk';
import * as SdkNode from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunManager } from './runs.js';
import {
  AGENT_SERVER_TOKEN_HEADER,
  readAgentServerLogDelta,
} from './server.js';
import {
  activateManaged,
  cleanupAll,
  CONSOLE_ORIGIN,
  fixture,
  HOST,
  pair,
  registerCleanup,
} from './server-test-harness.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAll();
});

describe('agent server providers and runs', () => {
  it('caps log replay without dropping lines appended across polls', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agent-server-log-tail-'));
    registerCleanup(() => rmSync(temp, { recursive: true, force: true }));
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
        models: [{ id: 'model' }],
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
        models: [{ id: 'qwen3-coder:480b-cloud' }],
        apiKey: 'super-secret-value',
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      api: 'openai-completions',
      baseUrl: 'https://ollama.com/v1',
      envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
      models: [{ id: 'qwen3-coder:480b-cloud' }],
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
        models: [{ id: 'qwen3-coder:480b-cloud' }, { id: 'gpt-oss:120b' }],
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
        models: [{ id: 'qwen3-coder:480b-cloud' }],
      },
    });
    expect(redirect.json()).toMatchObject({ hasApiKey: true });
    expect(store.readProviders().ollama.apiKeyRef).toBeDefined();
    expect(existsSync(join(store.secretsDir, 'pi-provider', 'ollama'))).toBe(
      true,
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
        models: [{ id: 'qwen3-coder:480b-cloud' }],
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

  it('preserves the legacy HTTP error code when removing a missing provider', async () => {
    const { app } = await fixture();
    const token = await pair(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/providers/missing',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: 'agent_server_provider_not_found',
    });
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
      models: [{ id: 'model' }],
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
        models: [{ id: 'qwen3-coder:480b-cloud' }],
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
      '--heartbeat-interval-ms',
      '60000',
      '--warm-retention-sec',
      '1800',
    ]);
    expect(options.env['MOLTNET_AGENT_KEY_REF']).toBe('file:agent-key/agent-1');
    expect(options.env['MOLTNET_PRIVATE_KEY_REF']).toBe(
      'file:identity/FP-1/seed',
    );
    expect(options.env['MOLTNET_SECRET_ROOT']).toBe(store.secretsDir);
    expect(options.env['MOLTNET_EXPECTED_SUBJECT_ID']).toBe('agent-1');
    expect(options.env['MOLTNET_EXPECTED_SUBJECT_TYPE']).toBe('agent');
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

  it('answers 409 for a pending registration that cannot be resumed', async () => {
    const { app, store } = await fixture();
    const token = await pair(app);
    // A pending record whose config was never written cannot be resumed.
    store.reserveRegistration('pending-bot', 'https://api.themolt.net');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agents/pending-bot/reconcile',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
        'content-type': 'application/json',
      },
      payload: { action: 'resume' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'registration_incomplete' });
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
    expect(childEnv['MOLTNET_AGENT_KEY_REF']).toBe('file:agent-key/agent-1');
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
    const signing = await cryptoService.generateKeyPair();
    const agentRoot = join(store.root, 'external-root');
    const configDir = join(agentRoot, '.moltnet', 'configured-name');
    const configPath = join(configDir, 'moltnet.json');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        subject_id: 'agent-1',
        subject_type: 'agent',
        registered_at: 't',
        oauth2: {
          client_id: 'client',
          client_secret_ref: {
            provider: 'memory',
            key: 'oauth2/agent-1/client',
          },
        },
        agent_key_ref: {
          provider: 'memory',
          key: 'agent-key/agent-1',
        },
        keys: {
          public_key: signing.publicKey,
          private_key: signing.privateKey,
          fingerprint: signing.fingerprint,
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
      subjectId: 'agent-1',
      publicKey: signing.publicKey,
      fingerprint: signing.fingerprint,
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

    expect(response.statusCode, response.body).toBe(201);
    expect(spawned[0]?.args).toContain('configured-name');
    expect(spawned[0]?.args).toContain(agentRoot);
    expect(spawned[0]?.options.env['MOLTNET_API_URL']).toBe(
      'http://127.0.0.1:4000',
    );
    expect(spawned[0]?.options.env['MOLTNET_AGENT_KEY']).toBe(
      'resolved-external-agent-key',
    );
    expect(spawned[0]?.options.env['MOLTNET_CLIENT_ID']).toBeUndefined();
    expect(spawned[0]?.options.env['MOLTNET_CLIENT_SECRET']).toBeUndefined();
    expect(spawned[0]?.options.env['MOLTNET_EXPECTED_SUBJECT_ID']).toBe(
      'agent-1',
    );
    expect(spawned[0]?.options.env['MOLTNET_EXPECTED_SUBJECT_TYPE']).toBe(
      'agent',
    );
    expect(spawned[0]?.options.env['MOLTNET_EXPECTED_PUBLIC_KEY']).toBe(
      signing.publicKey,
    );
    expect(spawned[0]?.options.env['MOLTNET_EXPECTED_FINGERPRINT']).toBe(
      signing.fingerprint,
    );
  });

  it('launches a central identity without a legacy agent-root override', async () => {
    const signing = await cryptoService.generateKeyPair();
    const privateKeyRef = `identity/${signing.fingerprint}/seed`;
    const { app, store, spawned } = await fixture({
      externalSecrets: {
        'agent-key/agent-1': 'resolved-central-agent-key',
        [privateKeyRef]: signing.privateKey,
      },
    });
    const token = await pair(app);
    store.writeAgentConfig('central', {
      subject_id: 'agent-1',
      subject_type: 'agent',
      registered_at: 't',
      agent_key_ref: { provider: 'memory', key: 'agent-key/agent-1' },
      keys: {
        public_key: signing.publicKey,
        fingerprint: signing.fingerprint,
        private_key_ref: { provider: 'memory', key: privateKeyRef },
      },
      endpoints: {
        api: 'https://api.example',
        mcp: 'https://mcp.example/mcp',
      },
    });
    store.writeActivation({
      source: 'external',
      alias: 'central',
      subjectId: 'agent-1',
      publicKey: signing.publicKey,
      fingerprint: signing.fingerprint,
      createdAt: 't',
      configPath: store.agentPath('central'),
      configApiUrl: 'https://api.example',
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
        agent: 'central',
        teamId: 'team-1',
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(spawned[0]?.args).toContain('central');
    expect(spawned[0]?.args).not.toContain('--agent-root');
    expect(spawned[0]?.options.env['MOLTNET_AGENT_KEY']).toBe(
      'resolved-central-agent-key',
    );
    expect(spawned[0]?.options.env['MOLTNET_PRIVATE_KEY']).toBe(
      signing.privateKey,
    );
  });

  it('launches external team slots through verification, profile lookup and child projection', async () => {
    const keys = await cryptoService.generateKeyPair();
    const privateKeyRef = `identity/${keys.fingerprint}/seed`;
    const externalSecrets = {
      'agent-key/agent-1/a': 'external-a',
      'agent-key/agent-1/b': 'external-b',
      [privateKeyRef]: keys.privateKey,
    };
    const profileRequests: { agentKey: string | undefined; teamId: string }[] =
      [];
    const connectMock = vi.spyOn(SdkNode, 'connect').mockImplementation(
      async (options) =>
        ({
          agents: {
            whoami: async () => ({
              subjectId: 'agent-1',
              subjectType: 'agent',
              publicKey: keys.publicKey,
              fingerprint: keys.fingerprint,
              credentialBinding: {
                bindingScope: 'team',
                boundTeamId: options?.agentKey?.slice(-1),
              },
            }),
          },
          runtimeProfiles: {
            list: async ({ teamId }: { teamId: string }) => {
              profileRequests.push({ agentKey: options?.agentKey, teamId });
              return {
                items: [
                  {
                    id: `profile-${teamId}`,
                    name: 'profile',
                    teamId,
                    runtimeKind: 'gondolin_pi',
                    sandbox: {},
                  },
                ],
              };
            },
          },
        }) as unknown as Awaited<ReturnType<typeof SdkNode.connect>>,
    );
    const { app, store, spawned } = await fixture({
      externalSecrets,
      realCredentialPreflight: true,
    });
    store.writeAgentConfig('central', {
      subject_id: 'agent-1',
      subject_type: 'agent',
      registered_at: 't',
      agent_key_ref: { provider: 'memory', key: 'agent-key/agent-1' },
      agent_key_refs: {
        a: { provider: 'memory', key: 'agent-key/agent-1/a' },
        b: { provider: 'memory', key: 'agent-key/agent-1/b' },
      },
      keys: {
        public_key: keys.publicKey,
        fingerprint: keys.fingerprint,
        private_key_ref: { provider: 'memory', key: privateKeyRef },
      },
      endpoints: {
        api: 'https://api.themolt.net',
        mcp: 'https://mcp.themolt.net',
      },
    });
    store.writeActivation({
      source: 'external',
      alias: 'central',
      subjectId: 'agent-1',
      publicKey: keys.publicKey,
      fingerprint: keys.fingerprint,
      createdAt: 't',
      configPath: store.agentPath('central'),
      configApiUrl: 'https://api.themolt.net',
    });
    const token = await pair(app);
    const start = (teamId: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/runs',
        headers: {
          host: HOST,
          origin: CONSOLE_ORIGIN,
          [AGENT_SERVER_TOKEN_HEADER]: token,
          'content-type': 'application/json',
        },
        payload: {
          agent: 'central',
          teamId,
          profiles: ['profile'],
          taskTypes: ['freeform'],
          mode: 'poll',
        },
      });
    const responses = await Promise.all([start('a'), start('b')]);
    for (const response of responses)
      expect(response.statusCode, response.body).toBe(201);
    expect(profileRequests).toEqual(
      expect.arrayContaining([
        { agentKey: 'external-a', teamId: 'a' },
        { agentKey: 'external-b', teamId: 'b' },
      ]),
    );
    expect(profileRequests).toHaveLength(2);
    for (const child of spawned) {
      const env = child.options.env;
      expect(env.MOLTNET_AGENT_KEY).toBe(`external-${env.MOLTNET_TEAM_ID}`);
      expect(env.MOLTNET_PRIVATE_KEY).toBe(keys.privateKey);
      expect(env.MOLTNET_CLIENT_SECRET).toBeUndefined();
      expect(child.args).toContain(env.MOLTNET_TEAM_ID);
    }

    // A configured but unavailable slot cannot use the valid fallback or other team.
    delete (externalSecrets as Record<string, string>)['agent-key/agent-1/b'];
    connectMock.mockClear();
    profileRequests.length = 0;
    const failed = await start('b');
    expect(failed.statusCode).toBe(400);
    expect(failed.json()).toMatchObject({ code: 'verification_failed' });
    expect(connectMock).not.toHaveBeenCalled();
    expect(profileRequests).toEqual([]);
    expect(spawned).toHaveLength(2);

    connectMock.mockRejectedValueOnce(
      new Error('upstream error with external-a'),
    );
    const rejected = await start('a');
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({
      code: 'verification_failed',
      message:
        'Cannot start agent "central" for team "a": credential verification failed. Check the selected team key and activation.',
    });
    expect(rejected.body).not.toContain('external-a');
    expect(spawned).toHaveLength(2);
  });

  it('projects independent team references into concurrent managed children', async () => {
    const { app, store, spawned } = await fixture();
    activateManaged(store);
    const config = store.readAgentConfig('course-bot')!;
    config.agent_key_refs = {
      a: { provider: 'file', key: 'agent-key/agent-1/a' },
      b: { provider: 'file', key: 'agent-key/agent-1/b' },
    };
    store.writeAgentConfig('course-bot', config);
    const token = await pair(app);
    const responses = await Promise.all(
      ['a', 'b'].map((teamId) =>
        app.inject({
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
            teamId,
            profiles: ['profile'],
            taskTypes: ['freeform'],
            mode: 'poll',
          },
        }),
      ),
    );
    for (const response of responses)
      expect(response.statusCode, response.body).toBe(201);
    expect(
      spawned.map(({ options }) => options.env.MOLTNET_AGENT_KEY_REF).sort(),
    ).toEqual(['file:agent-key/agent-1/a', 'file:agent-key/agent-1/b']);
    for (const { options } of spawned) {
      expect(options.env.MOLTNET_CLIENT_SECRET).toBeUndefined();
      expect(options.env.MOLTNET_AGENT_KEY).toBeUndefined();
    }
    expect(store.readAgentConfig('course-bot')?.agent_key_ref).toEqual(
      config.agent_key_ref,
    );
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

    const unknownTaskType = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers,
      payload: {
        agent: 'ghost',
        teamId: 'team-1',
        profiles: ['p'],
        taskTypes: ['unknown-task-type'],
        mode: 'poll',
      },
    });
    expect(unknownTaskType.statusCode).toBe(400);
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
        models: [{ id: 'model' }],
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

describe('team and diary travel together', () => {
  /** Start a run and return the env the child was spawned with. */
  async function startRun(
    payload: Record<string, unknown>,
    baseEnv: NodeJS.ProcessEnv,
  ) {
    const { app, store, spawned } = await fixture({ baseEnv });
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
        profiles: ['profile'],
        taskTypes: ['freeform'],
        mode: 'poll',
        ...payload,
      },
    });
    return { response, env: spawned[0]?.options.env ?? {} };
  }

  it('sets the diary the run was started for', async () => {
    // Arrange / Act
    const { response, env } = await startRun(
      { teamId: 'team-1', diaryId: 'diary-1' },
      { PATH: '/usr/bin' },
    );

    // Assert
    expect(response.statusCode).toBe(201);
    expect(env['MOLTNET_TEAM_ID']).toBe('team-1');
    expect(env['MOLTNET_DIARY_ID']).toBe('diary-1');
  });

  it('refuses to inherit a diary from the supervisor', async () => {
    // The CLI binds team and diary as a pair. A supervisor-level diary would
    // silently follow a run into a different team, which is exactly what the
    // desktop's team switching would surface.
    const { response, env } = await startRun(
      { teamId: 'team-2', diaryId: 'diary-2' },
      { PATH: '/usr/bin', MOLTNET_DIARY_ID: 'ambient-diary-of-another-team' },
    );

    expect(response.statusCode).toBe(201);
    expect(env['MOLTNET_DIARY_ID']).toBe('diary-2');
  });

  it('leaves the diary unset rather than inheriting one', async () => {
    // Arrange / Act
    const { response, env } = await startRun(
      { teamId: 'team-3' },
      { PATH: '/usr/bin', MOLTNET_DIARY_ID: 'ambient-diary-of-another-team' },
    );

    // Assert: absent beats wrong. The agent resolves its own diary downstream.
    expect(response.statusCode).toBe(201);
    expect(env['MOLTNET_TEAM_ID']).toBe('team-3');
    expect(env['MOLTNET_DIARY_ID']).toBeUndefined();
  });
});
describe('a failed run explains itself', () => {
  /** Start a run, emit stderr, then exit the child with `code`. */
  async function failRun(stderr: string[], code: number) {
    const { app, store, children } = await fixture();
    const token = await pair(app);
    activateManaged(store);
    const started = await app.inject({
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
    expect(started.statusCode).toBe(201);
    const runId = started.json<{ id: string }>().id;
    const child = children[0];
    for (const line of stderr) child?.stderr.write(`${line}\n`);
    child?.stderr.end();
    child?.emit('exit', code, null);
    // Completion is persisted asynchronously. Poll for the transition rather
    // than sleeping a guessed interval, which races under parallel test runs.
    type RunView = {
      id: string;
      status: string;
      lastError?: { message: string };
    };
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const list = await app.inject({
        method: 'GET',
        url: '/v1/runs',
        headers: {
          host: HOST,
          origin: CONSOLE_ORIGIN,
          [AGENT_SERVER_TOKEN_HEADER]: token,
        },
      });
      const run = list.json<RunView[]>().find((entry) => entry.id === runId);
      if (run && run.status !== 'running') return run;
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }
    throw new Error('the run never left the running state');
  }

  it('records why the worker stopped', async () => {
    // Act
    const run = await failRun(
      ['poll  worker ready', 'run   ERROR profile needs ACME_WORKSPACE_TOKEN'],
      1,
    );

    // Assert
    expect(run?.status).toBe('failed');
    expect(run?.lastError?.message).toContain('ACME_WORKSPACE_TOKEN');
  });

  it('leaves no error on a run that ended cleanly', async () => {
    // Arrange / Act
    const run = await failRun(['poll  worker ready'], 0);

    // Assert
    expect(run?.status).toBe('exited');
    expect(run?.lastError).toBeUndefined();
  });
});
