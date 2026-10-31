import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ollamaCloudModelData } from '@moltnet/provider-catalog';
import { afterEach, describe, expect, it } from 'vitest';

import { type PiModelCost, writePiConfig } from '../src/pi-config.js';

const roots: string[] = [];

function piDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-eval-pi-'));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('writePiConfig', () => {
  it('preserves the existing single-provider eval output', () => {
    const dir = piDir();

    writePiConfig({
      piDir: dir,
      provider: 'ollama-cloud',
      model: 'qwen3-coder:480b-cloud',
    });

    expect(JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8'))).toEqual({
      providers: {
        'ollama-cloud': {
          api: 'openai-completions',
          apiKey: '$OLLAMA_API_KEY',
          baseUrl: 'https://ollama.com/v1',
          models: [{ id: 'qwen3-coder:480b-cloud', type: 'chat' }],
        },
      },
    });
    expect(
      JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')),
    ).toEqual({
      defaultModel: 'qwen3-coder:480b-cloud',
      defaultProvider: 'ollama-cloud',
      enableInstallTelemetry: false,
      enabledModels: ['ollama-cloud/qwen3-coder:480b-cloud'],
      packages: ['npm:@themoltnet/pi-extension'],
      transport: 'sse',
      treeFilterMode: 'default',
    });
  });

  it('emits declared input modalities and omits them when undeclared', () => {
    const dir = piDir();

    writePiConfig({
      piDir: dir,
      providers: {
        'ollama-cloud': {
          api: 'openai-completions',
          apiKeyEnvRef: '$OLLAMA_API_KEY',
          baseUrl: 'https://ollama.com/v1',
          models: [
            { id: 'qwen3.5:397b-cloud', input: ['text', 'image'] },
            { id: 'glm-5.2:cloud' },
            { id: 'gpt-oss:120b-cloud' },
          ],
        },
      },
    });

    const models = JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8'));
    expect(models.providers['ollama-cloud'].models).toEqual([
      { id: 'qwen3.5:397b-cloud', input: ['text', 'image'], type: 'chat' },
      { id: 'glm-5.2:cloud', type: 'chat' },
      { id: 'gpt-oss:120b-cloud', type: 'chat' },
    ]);
  });

  it('declares input modalities for the single-provider eval form', () => {
    const dir = piDir();

    writePiConfig({
      piDir: dir,
      provider: 'ollama-cloud',
      model: 'qwen3.5:397b-cloud',
      input: ['text', 'image'],
    });

    const models = JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8'));
    expect(models.providers['ollama-cloud'].models).toEqual([
      { id: 'qwen3.5:397b-cloud', input: ['text', 'image'], type: 'chat' },
    ]);
  });

  it('writes multiple providers, environment placeholders, and custom settings', () => {
    const dir = piDir();

    writePiConfig({
      piDir: dir,
      providers: {
        ollama: {
          api: 'openai-completions',
          apiKeyEnvRef: '$OLLAMA_API_KEY',
          baseUrl: 'https://ollama.com/v1',
          models: [{ id: 'qwen' }, { id: 'gpt-oss' }],
        },
        local: {
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:11434/v1',
          models: [{ id: 'local-model' }],
        },
      },
      settings: { defaultProvider: 'local', transport: 'sse' },
    });

    const models = JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8'));
    expect(models.providers.ollama).toMatchObject({
      apiKey: '$OLLAMA_API_KEY',
      models: [{ id: 'qwen' }, { id: 'gpt-oss' }],
    });
    expect(models.providers.local).not.toHaveProperty('apiKey');
    expect(
      JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')),
    ).toEqual({
      enableInstallTelemetry: false,
      defaultProvider: 'local',
      transport: 'sse',
    });
  });
});

type PiConfig = {
  providers: Record<
    string,
    {
      compat?: Record<string, boolean>;
      models: { cost?: PiModelCost; compat?: Record<string, boolean> }[];
    }
  >;
};

it('prices the Ollama Cloud endpoint while preserving explicit custom rates', () => {
  const piDir = mkdtempSync(join(tmpdir(), 'pi-pricing-config-'));
  const id = 'gpt-oss:120b';
  const customCost = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 };
  try {
    writePiConfig({
      piDir,
      providers: {
        cloud: {
          api: 'openai-completions',
          baseUrl: 'https://ollama.com/v1',
          models: [{ id }],
        },
        custom: {
          api: 'openai-completions',
          baseUrl: 'https://ollama.com/v1',
          models: [{ id, cost: customCost }],
        },
        local: {
          api: 'openai-completions',
          baseUrl: 'http://localhost:11434/v1',
          models: [{ id }],
        },
        other: {
          api: 'openai-completions',
          baseUrl: 'https://provider.example/v1',
          models: [{ id }],
        },
        unknown: {
          api: 'openai-completions',
          baseUrl: 'https://ollama.com/v1',
          models: [{ id: 'unlisted-model' }],
        },
      },
    });
    const { providers } = JSON.parse(
      readFileSync(join(piDir, 'models.json'), 'utf8'),
    ) as PiConfig;

    expect(
      ollamaCloudModelData.find((model) => model.id === id)?.cost,
    ).toBeDefined();
    expect(providers.cloud.models[0].cost).toEqual(
      ollamaCloudModelData.find((model) => model.id === id)?.cost,
    );
    expect(providers.custom.models[0].cost).toEqual(customCost);
    for (const provider of ['local', 'other', 'unknown'])
      expect(providers[provider].models[0]).not.toHaveProperty('cost');

    writePiConfig({ piDir, provider: 'cloud', model: id });
    const single = JSON.parse(
      readFileSync(join(piDir, 'models.json'), 'utf8'),
    ) as PiConfig;
    expect(single.providers.cloud.models[0].cost).toEqual(
      providers.cloud.models[0].cost,
    );
  } finally {
    rmSync(piDir, { recursive: true, force: true });
  }
});

it('prices an Ollama Cloud classifier by its input-only rate alone', () => {
  const piDir = mkdtempSync(join(tmpdir(), 'pi-classifier-pricing-'));
  const classifier = ollamaCloudModelData.find((model) => model.classifierCost);
  const chat = ollamaCloudModelData.find((model) => model.cost);
  try {
    if (!classifier?.classifierCost || !chat) throw new Error('no fixtures');
    writePiConfig({
      piDir,
      providers: {
        cloud: {
          api: 'openai-completions',
          baseUrl: 'https://ollama.com/v1',
          models: [
            { id: classifier.id, type: 'classifier' },
            { id: chat.id, type: 'classifier' },
          ],
        },
        chat: {
          api: 'openai-completions',
          baseUrl: 'https://ollama.com/v1',
          models: [{ id: classifier.id }],
        },
      },
    });
    const { providers } = JSON.parse(
      readFileSync(join(piDir, 'models.json'), 'utf8'),
    ) as PiConfig;

    expect(providers.cloud.models[0].cost).toEqual(classifier.classifierCost);
    expect(providers.cloud.models[1]).not.toHaveProperty('cost');
    expect(providers.chat.models[0]).not.toHaveProperty('cost');
  } finally {
    rmSync(piDir, { recursive: true, force: true });
  }
});

it('declares strict tool support for an opted-in single-provider model', () => {
  const piDir = mkdtempSync(join(tmpdir(), 'pi-strict-config-'));
  try {
    writePiConfig({
      piDir,
      provider: 'ollama-cloud',
      model: 'glm-5.2:cloud',
      supportsStrictMode: true,
      supportsDeveloperRole: false,
    });

    const config = JSON.parse(
      readFileSync(join(piDir, 'models.json'), 'utf8'),
    ) as PiConfig;
    expect(config.providers['ollama-cloud'].compat).toEqual({
      supportsDeveloperRole: false,
    });
    expect(config.providers['ollama-cloud'].models[0].compat).toEqual({
      supportsStrictMode: true,
    });
  } finally {
    rmSync(piDir, { recursive: true, force: true });
  }
});

it('uses explicit provider message-role compatibility', () => {
  const piDir = mkdtempSync(join(tmpdir(), 'pi-provider-compat-'));
  try {
    writePiConfig({
      piDir,
      providers: {
        cloud: {
          api: 'openai-completions',
          baseUrl: 'https://ollama.com/v1',
          supportsDeveloperRole: false,
          models: [{ id: 'mistral-large-4', reasoning: true }],
        },
        local: {
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:11434/v1',
          supportsDeveloperRole: false,
          models: [{ id: 'gpt-oss:20b', reasoning: true }],
        },
        other: {
          api: 'openai-completions',
          baseUrl: 'https://provider.example/v1',
          supportsDeveloperRole: true,
          models: [{ id: 'reasoning-model', reasoning: true }],
        },
      },
    });

    const config = JSON.parse(
      readFileSync(join(piDir, 'models.json'), 'utf8'),
    ) as PiConfig;
    expect(config.providers.cloud.compat).toEqual({
      supportsDeveloperRole: false,
    });
    expect(config.providers.local.compat).toEqual({
      supportsDeveloperRole: false,
    });
    expect(config.providers.other.compat).toEqual({
      supportsDeveloperRole: true,
    });
  } finally {
    rmSync(piDir, { recursive: true, force: true });
  }
});
