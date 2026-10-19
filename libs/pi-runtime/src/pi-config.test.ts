import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ollamaCloudModelData } from '@moltnet/provider-catalog';
import { expect, it } from 'vitest';

import { type PiModelCost, writePiConfig } from './pi-config.js';

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
