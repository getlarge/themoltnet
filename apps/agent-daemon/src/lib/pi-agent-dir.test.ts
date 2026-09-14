import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProvidersState } from './agent-server/store.js';
import { type PiAgentDir, resolvePiAgentDir } from './pi-agent-dir.js';

const STORE_OLLAMA: ProvidersState = {
  'ollama-cloud': {
    api: 'openai-completions',
    baseUrl: 'https://ollama.com/v1',
    envName: 'MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY',
    models: ['glm-5.2'],
    apiKeyRef: 'file:providers/ollama-cloud/api-key',
  },
};

const REPO_MODELS = {
  providers: {
    'ollama-cloud': {
      api: 'openai-completions',
      apiKey: '$OLLAMA_API_KEY',
      baseUrl: 'https://ollama.com/v1',
      models: [
        { id: 'glm-5.2:cloud', contextWindow: 202752, reasoning: true },
        { id: 'glm-5.2' },
      ],
    },
    ollama: {
      api: 'openai-completions',
      apiKey: '$OLLAMA_API_KEY',
      baseUrl: 'http://127.0.0.1:11434/v1',
      models: [{ id: 'gemma4:12b' }],
    },
  },
};

const OLLAMA_CLOUD_PROFILE = [{ provider: 'ollama-cloud' }];

describe('resolvePiAgentDir', () => {
  const tempRoots: string[] = [];
  const resolved: PiAgentDir[] = [];

  afterEach(() => {
    for (const dir of resolved.splice(0)) dir.cleanup();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'agent-daemon-pi-dir-'));
    tempRoots.push(dir);
    return dir;
  }

  function writeStore(
    root: string,
    input: { providers?: ProvidersState; auth?: Record<string, unknown> },
  ): void {
    if (input.providers) {
      writeFileSync(
        join(root, 'providers.json'),
        JSON.stringify(input.providers),
      );
    }
    if (input.auth) {
      mkdirSync(join(root, 'pi'), { recursive: true });
      writeFileSync(join(root, 'pi', 'auth.json'), JSON.stringify(input.auth));
    }
  }

  function writeRepoPi(
    agentRoot: string,
    files: Partial<Record<'models' | 'auth' | 'settings', unknown>>,
  ): void {
    mkdirSync(join(agentRoot, '.pi'), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(
        join(agentRoot, '.pi', `${name}.json`),
        JSON.stringify(content),
      );
    }
  }

  function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, 'utf8'));
  }

  async function resolve(input: {
    agentRoot: string;
    storeRoot: string;
    piCodingAgentDir?: string;
    env?: NodeJS.ProcessEnv;
    profiles?: ReadonlyArray<{ provider: string }>;
    secrets?: Record<string, string>;
    tempRoot?: string;
  }): Promise<PiAgentDir> {
    const secrets = input.secrets ?? {};
    const result = await resolvePiAgentDir(
      {
        piCodingAgentDir: input.piCodingAgentDir ?? '',
        agentServerRoot: input.storeRoot,
        profilePrerequisiteEnv: input.env ?? {},
      },
      input.agentRoot,
      input.profiles ?? [],
      {
        secretProviders: {
          resolve: ({ key }) =>
            key in secrets
              ? Promise.resolve(secrets[key])
              : Promise.reject(new Error('secret not found')),
        },
        tempRoot: input.tempRoot ?? tempDir(),
      },
    );
    resolved.push(result);
    return result;
  }

  it('uses PI_CODING_AGENT_DIR unchanged even when a store exists', async () => {
    // Arrange
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA, auth: {} });
    const explicit = join(tempDir(), 'pi-agent');

    // Act
    const result = await resolve({
      agentRoot: tempDir(),
      storeRoot,
      piCodingAgentDir: explicit,
    });

    // Assert
    expect(result).toMatchObject({ path: explicit, source: 'env', env: {} });
    expect(statSync(explicit).isDirectory()).toBe(true);
  });

  it('falls back to repo .pi when the store has no providers and no login', async () => {
    // Arrange
    const agentRoot = tempDir();

    // Act
    const result = await resolve({
      agentRoot,
      storeRoot: join(tempDir(), 'missing'),
      profiles: OLLAMA_CLOUD_PROFILE,
    });

    // Assert
    expect(result).toMatchObject({
      path: join(agentRoot, '.pi'),
      source: 'repo',
      env: {},
    });
  });

  it('composes a private dir from store providers, login and API keys', async () => {
    // Arrange
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA, auth: { codex: {} } });

    // Act
    const result = await resolve({
      agentRoot: tempDir(),
      storeRoot,
      profiles: OLLAMA_CLOUD_PROFILE,
      secrets: { 'providers/ollama-cloud/api-key': 'sk-store' },
    });

    // Assert
    expect(result.source).toBe('store');
    expect(statSync(result.path).mode & 0o777).toBe(0o700);
    expect(readJson(join(result.path, 'models.json'))).toEqual({
      providers: {
        'ollama-cloud': {
          api: 'openai-completions',
          apiKey: '$MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY',
          baseUrl: 'https://ollama.com/v1',
          models: [{ id: 'glm-5.2' }],
        },
      },
    });
    expect(realpathSync(join(result.path, 'auth.json'))).toBe(
      realpathSync(join(storeRoot, 'pi', 'auth.json')),
    );
    expect(result.env).toEqual({
      MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY: 'sk-store',
    });
  });

  it('layers repo models and settings under the store catalog', async () => {
    // Arrange
    const agentRoot = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA });
    writeRepoPi(agentRoot, {
      models: REPO_MODELS,
      settings: { transport: 'sse' },
    });

    // Act
    const result = await resolve({
      agentRoot,
      storeRoot,
      profiles: OLLAMA_CLOUD_PROFILE,
      secrets: { 'providers/ollama-cloud/api-key': 'sk-store' },
    });

    // Assert
    expect(readJson(join(result.path, 'models.json'))).toEqual({
      providers: {
        'ollama-cloud': {
          api: 'openai-completions',
          apiKey: '$MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY',
          baseUrl: 'https://ollama.com/v1',
          models: [
            { id: 'glm-5.2' },
            { id: 'glm-5.2:cloud', contextWindow: 202752, reasoning: true },
          ],
        },
        ollama: REPO_MODELS.providers.ollama,
      },
    });
    expect(readJson(join(result.path, 'settings.json'))).toEqual({
      transport: 'sse',
    });
  });

  it.each([
    { storeLogin: true, expected: { codex: { access: 'store' } } },
    { storeLogin: false, expected: { anthropic: { access: 'repo' } } },
  ])(
    'links one auth.json, never merged (store login: $storeLogin)',
    async ({ storeLogin, expected }) => {
      // Arrange
      const agentRoot = tempDir();
      const storeRoot = tempDir();
      writeStore(storeRoot, {
        providers: STORE_OLLAMA,
        ...(storeLogin ? { auth: { codex: { access: 'store' } } } : {}),
      });
      writeRepoPi(agentRoot, { auth: { anthropic: { access: 'repo' } } });

      // Act
      const result = await resolve({ agentRoot, storeRoot });

      // Assert
      expect(readJson(join(result.path, 'auth.json'))).toEqual(expected);
    },
  );

  it('keeps a provider key already set in the environment', async () => {
    // Arrange
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA });

    // Act
    const result = await resolve({
      agentRoot: tempDir(),
      storeRoot,
      profiles: OLLAMA_CLOUD_PROFILE,
      env: { MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY: 'sk-operator' },
    });

    // Assert
    expect(result.env).toEqual({});
  });

  it('fails and removes the composed dir when a selected key cannot be resolved', async () => {
    // Arrange
    const storeRoot = tempDir();
    const tempRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA });

    // Act
    const attempt = resolve({
      agentRoot: tempDir(),
      storeRoot,
      profiles: OLLAMA_CLOUD_PROFILE,
      tempRoot,
    });

    // Assert
    await expect(attempt).rejects.toThrow(
      'provider "ollama-cloud" API key could not be resolved',
    );
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('cleanup removes the composed dir but not the store login', async () => {
    // Arrange
    const storeRoot = tempDir();
    writeStore(storeRoot, { auth: { codex: {} } });
    const result = await resolve({ agentRoot: tempDir(), storeRoot });

    // Act
    result.cleanup();

    // Assert
    expect(() => statSync(result.path)).toThrow();
    expect(statSync(join(storeRoot, 'pi', 'auth.json')).isFile()).toBe(true);
  });
});
