import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writePiConfig } from '../src/pi-config.js';

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
          models: [{ id: 'qwen3-coder:480b-cloud' }],
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

  it('writes multiple providers, environment placeholders, and custom settings', () => {
    const dir = piDir();

    writePiConfig({
      piDir: dir,
      providers: {
        ollama: {
          api: 'openai-completions',
          apiKeyEnvRef: '$OLLAMA_API_KEY',
          baseUrl: 'https://ollama.com/v1',
          models: ['qwen', 'gpt-oss'],
        },
        local: {
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:11434/v1',
          models: ['local-model'],
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
