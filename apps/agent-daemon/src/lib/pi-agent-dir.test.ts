import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProvidersState } from './agent-server/store.js';
import {
  type ComposedPiAgentDir,
  ensurePiAgentDir,
  PiAgentDirResolutionError,
  resolvePiAgentDir,
} from './pi-agent-dir.js';

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

describe('ensurePiAgentDir', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'agent-daemon-pi-dir-'));
    tempRoots.push(dir);
    return dir;
  }

  it('defaults daemon Pi config to repo-local .pi', () => {
    const repo = tempDir();

    expect(ensurePiAgentDir(repo, '')).toEqual({
      path: join(repo, '.pi'),
      source: 'repo',
    });
  });

  it('preserves an explicit PI_CODING_AGENT_DIR override', () => {
    const repo = tempDir();
    const explicit = join(tempDir(), 'pi-agent');

    expect(ensurePiAgentDir(repo, explicit)).toEqual({
      path: explicit,
      source: 'env',
    });
  });
});

describe('resolvePiAgentDir', () => {
  const tempRoots: string[] = [];
  const composed: ComposedPiAgentDir[] = [];

  afterEach(() => {
    for (const dir of composed.splice(0)) dir.cleanup();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'agent-daemon-pi-resolve-'));
    tempRoots.push(dir);
    return dir;
  }

  function writeStore(
    root: string,
    input: { providers?: ProvidersState; auth?: Record<string, unknown> },
  ): void {
    mkdirSync(root, { recursive: true });
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
    repo: string,
    input: {
      models?: unknown;
      auth?: Record<string, unknown>;
      settings?: Record<string, unknown>;
    },
  ): void {
    mkdirSync(join(repo, '.pi'), { recursive: true });
    if (input.models) {
      writeFileSync(
        join(repo, '.pi', 'models.json'),
        JSON.stringify(input.models),
      );
    }
    if (input.auth) {
      writeFileSync(join(repo, '.pi', 'auth.json'), JSON.stringify(input.auth));
    }
    if (input.settings) {
      writeFileSync(
        join(repo, '.pi', 'settings.json'),
        JSON.stringify(input.settings),
      );
    }
  }

  const fakeSecrets = (values: Record<string, string> = {}) => ({
    resolve: (reference: { provider: string; key: string }) => {
      const value = values[reference.key];
      return value === undefined
        ? Promise.reject(new Error('secret not found'))
        : Promise.resolve(value);
    },
  });

  async function resolve(
    input: Partial<Parameters<typeof resolvePiAgentDir>[0]> & {
      repoRoot: string;
      storeRoot: string;
    },
  ): Promise<ComposedPiAgentDir> {
    const result = await resolvePiAgentDir({
      explicitPath: '',
      profiles: [],
      env: {},
      secretProviders: fakeSecrets(),
      tempRoot: tempDir(),
      ...input,
    });
    composed.push(result);
    return result;
  }

  function readModels(dir: string): {
    providers: Record<
      string,
      { apiKey?: string; models: Array<{ id: string } & object> }
    >;
  } {
    return JSON.parse(
      readFileSync(join(dir, 'models.json'), 'utf8'),
    ) as ReturnType<typeof readModels>;
  }

  it('uses PI_CODING_AGENT_DIR unchanged even when a store exists', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA, auth: { a: {} } });
    const explicit = join(tempDir(), 'pi-agent');

    // Act
    const result = await resolve({
      repoRoot: repo,
      storeRoot,
      explicitPath: explicit,
    });

    // Assert
    expect(result).toMatchObject({
      path: explicit,
      source: 'env',
      providerEnv: {},
    });
  });

  it('falls back to repo .pi when the store root is missing', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = join(tempDir(), 'missing');

    // Act
    const result = await resolve({ repoRoot: repo, storeRoot });

    // Assert
    expect(result).toMatchObject({
      path: join(repo, '.pi'),
      source: 'repo',
    });
    expect(() => statSync(storeRoot)).toThrow();
  });

  it('falls back to repo .pi when the store has no providers and no auth', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, {});

    // Act
    const result = await resolve({
      repoRoot: repo,
      storeRoot,
      profiles: [
        { id: 'p1', provider: 'ollama-cloud', model: 'not-validated-here' },
      ],
    });

    // Assert
    expect(result).toMatchObject({ path: join(repo, '.pi'), source: 'repo' });
  });

  it('composes a private dir from the store only', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, {
      providers: STORE_OLLAMA,
      auth: { 'openai-codex': {} },
    });

    // Act
    const result = await resolve({
      repoRoot: repo,
      storeRoot,
      profiles: [{ id: 'p1', provider: 'ollama-cloud', model: 'glm-5.2' }],
      secretProviders: fakeSecrets({
        'providers/ollama-cloud/api-key': 'sk-store',
      }),
    });

    // Assert
    expect(result.source).toBe('store');
    expect(result.authSource).toBe('store');
    expect(statSync(result.path).mode & 0o777).toBe(0o700);
    expect(readModels(result.path).providers).toEqual({
      'ollama-cloud': {
        api: 'openai-completions',
        apiKey: '$MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY',
        baseUrl: 'https://ollama.com/v1',
        models: [{ id: 'glm-5.2' }],
      },
    });
    const authLink = join(result.path, 'auth.json');
    expect(lstatSync(authLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(authLink)).toBe(join(storeRoot, 'pi', 'auth.json'));
    expect(result.providerEnv).toEqual({
      MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY: 'sk-store',
    });
  });

  it('merges repo providers and model ids the store lacks, keeping :cloud ids resolvable', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA });
    writeRepoPi(repo, { models: REPO_MODELS });

    // Act
    const result = await resolve({
      repoRoot: repo,
      storeRoot,
      profiles: [
        { id: 'team', provider: 'ollama-cloud', model: 'glm-5.2:cloud' },
        { id: 'local', provider: 'ollama', model: 'gemma4:12b' },
      ],
      secretProviders: fakeSecrets({
        'providers/ollama-cloud/api-key': 'sk-store',
      }),
    });

    // Assert
    expect(result.source).toBe('store+repo');
    const providers = readModels(result.path).providers;
    expect(providers['ollama-cloud']).toEqual({
      api: 'openai-completions',
      apiKey: '$MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY',
      baseUrl: 'https://ollama.com/v1',
      models: [
        { id: 'glm-5.2' },
        { id: 'glm-5.2:cloud', contextWindow: 202752, reasoning: true },
      ],
    });
    expect(providers['ollama']).toEqual(REPO_MODELS.providers.ollama);
  });

  it('carries repo settings.json into the composed dir', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, { auth: { 'openai-codex': {} } });
    writeRepoPi(repo, { settings: { transport: 'sse', theme: 'dark' } });

    // Act
    const result = await resolve({ repoRoot: repo, storeRoot });

    // Assert
    expect(result.source).toBe('store+repo');
    expect(
      JSON.parse(readFileSync(join(result.path, 'settings.json'), 'utf8')),
    ).toEqual({ transport: 'sse', theme: 'dark' });
  });

  it('prefers store auth over repo auth without merging the documents', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, {
      providers: STORE_OLLAMA,
      auth: { 'openai-codex': { access: 'store' } },
    });
    writeRepoPi(repo, { auth: { anthropic: { access: 'repo' } } });

    // Act
    const result = await resolve({ repoRoot: repo, storeRoot });

    // Assert
    expect(result.authSource).toBe('store');
    expect(
      JSON.parse(readFileSync(join(result.path, 'auth.json'), 'utf8')),
    ).toEqual({ 'openai-codex': { access: 'store' } });
  });

  it('links repo auth when the store has providers but no Pi auth', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA });
    writeRepoPi(repo, { auth: { anthropic: { access: 'repo' } } });

    // Act
    const result = await resolve({ repoRoot: repo, storeRoot });

    // Assert
    expect(result.source).toBe('store+repo');
    expect(result.authSource).toBe('repo');
    expect(realpathSync(join(result.path, 'auth.json'))).toBe(
      realpathSync(join(repo, '.pi', 'auth.json')),
    );
  });

  it('does not override a provider key already present in the environment', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA });

    // Act
    const result = await resolve({
      repoRoot: repo,
      storeRoot,
      profiles: [{ id: 'p1', provider: 'ollama-cloud', model: 'glm-5.2' }],
      env: { MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY: 'sk-operator' },
    });

    // Assert
    expect(result.providerEnv).toEqual({});
  });

  it('fails without exposing values when a selected provider key cannot be resolved', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA });

    // Act
    const attempt = resolve({
      repoRoot: repo,
      storeRoot,
      profiles: [{ id: 'p1', provider: 'ollama-cloud', model: 'glm-5.2' }],
    });

    // Assert
    await expect(attempt).rejects.toThrow(
      'provider "ollama-cloud" API key could not be resolved',
    );
  });

  it('rejects an unknown profile model and names the sources searched', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, { providers: STORE_OLLAMA });
    writeRepoPi(repo, { models: REPO_MODELS });

    // Act
    const attempt = resolve({
      repoRoot: repo,
      storeRoot,
      profiles: [
        { id: 'team', provider: 'ollama-cloud', model: 'missing-model' },
      ],
      secretProviders: fakeSecrets({
        'providers/ollama-cloud/api-key': 'sk-store',
      }),
    });

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(PiAgentDirResolutionError);
    await expect(attempt).rejects.toThrow(
      /invalid_model: Runtime profile "team" model "ollama-cloud\/missing-model".*sources searched: store, repo/,
    );
  });

  it('removes the composed dir on cleanup without touching the store auth', async () => {
    // Arrange
    const repo = tempDir();
    const storeRoot = tempDir();
    writeStore(storeRoot, { auth: { 'openai-codex': {} } });
    const result = await resolvePiAgentDir({
      repoRoot: repo,
      storeRoot,
      explicitPath: '',
      profiles: [],
      env: {},
      secretProviders: fakeSecrets(),
      tempRoot: tempDir(),
    });

    // Act
    result.cleanup();

    // Assert
    expect(() => statSync(result.path)).toThrow();
    expect(statSync(join(storeRoot, 'pi', 'auth.json')).isFile()).toBe(true);
  });
});
