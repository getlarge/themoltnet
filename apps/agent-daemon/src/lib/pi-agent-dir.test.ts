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
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RuntimeProfileModels } from '@moltnet/runtime-profiles';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProvidersState } from './agent-server/store.js';
import { type PiAgentDir, resolvePiAgentDir } from './pi-agent-dir.js';

const OLLAMA_CLOUD_COST: Record<string, unknown> = {
  input: expect.any(Number),
  output: expect.any(Number),
  cacheRead: expect.any(Number),
  cacheWrite: expect.any(Number),
};

const STORE_OLLAMA: ProvidersState = {
  'ollama-cloud': {
    api: 'openai-completions',
    baseUrl: 'https://ollama.com/v1',
    supportsDeveloperRole: false,
    envName: 'MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY',
    models: [{ id: 'glm-5.2', type: 'chat' }],
    apiKeyRef: 'file:providers/ollama-cloud/api-key',
  },
};

const OLLAMA_CLOUD_PROFILE = [
  { models: { generation: { provider: 'ollama-cloud', model: 'test' } } },
];

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

  function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, 'utf8'));
  }

  async function resolve(input: {
    storeRoot: string;
    piCodingAgentDir?: string;
    env?: NodeJS.ProcessEnv;
    profiles?: ReadonlyArray<{ models: RuntimeProfileModels }>;
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
      storeRoot,
      piCodingAgentDir: explicit,
    });

    // Assert
    expect(result).toMatchObject({ path: explicit, source: 'env', env: {} });
    expect(statSync(explicit).isDirectory()).toBe(true);
  });

  it('falls back to the global Pi dir when the store has no providers and no login', async () => {
    // Arrange
    const storeRoot = join(tempDir(), 'missing');

    // Act
    const result = await resolve({
      storeRoot,
      profiles: OLLAMA_CLOUD_PROFILE,
    });

    // Assert
    expect(result).toMatchObject({
      path: join(homedir(), '.pi', 'agent'),
      source: 'global',
      env: {},
    });
  });

  it('composes a private dir from store providers, login and API keys', async () => {
    // Arrange
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA, auth: { codex: {} } });

    // Act
    const result = await resolve({
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
          compat: { supportsDeveloperRole: false },
          models: [
            {
              id: 'glm-5.2',
              type: 'chat',
              cost: OLLAMA_CLOUD_COST,
            },
          ],
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

  it('links a dangling auth.json when the store has providers but no login', async () => {
    // Arrange
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA });

    // Act
    const result = await resolve({ storeRoot });

    // Assert
    expect(result.source).toBe('store');
    expect(() => readJson(join(result.path, 'auth.json'))).toThrow();
  });

  it.each([false, true])(
    'resolves classification credentials with generation=%s',
    async (withGeneration) => {
      const storeRoot = tempDir();
      writeStore(storeRoot, {
        providers: {
          ...STORE_OLLAMA,
          decisions: {
            ...STORE_OLLAMA['ollama-cloud'],
            envName: 'MOLTNET_PROVIDER_DECISIONS_API_KEY',
            apiKeyRef: 'file:providers/decisions/api-key',
          },
        },
      });
      const result = await resolve({
        storeRoot,
        profiles: [
          {
            models: {
              ...(withGeneration
                ? { generation: { provider: 'ollama-cloud', model: 'chat' } }
                : {}),
              classification: { provider: 'decisions', model: 'classifier' },
            },
          },
        ],
        secrets: {
          'providers/ollama-cloud/api-key': 'chat-key',
          'providers/decisions/api-key': 'classifier-key',
        },
      });
      expect(result.env).toEqual({
        ...(withGeneration
          ? { MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY: 'chat-key' }
          : {}),
        MOLTNET_PROVIDER_DECISIONS_API_KEY: 'classifier-key',
      });
    },
  );

  it('keeps a provider key already set in the environment', async () => {
    // Arrange
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA });

    // Act
    const result = await resolve({
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
    const result = await resolve({ storeRoot });

    // Act
    result.cleanup();

    // Assert
    expect(() => statSync(result.path)).toThrow();
    expect(statSync(join(storeRoot, 'pi', 'auth.json')).isFile()).toBe(true);
  });
});
