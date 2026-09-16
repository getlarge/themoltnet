import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeStorePiConfig } from './pi-store-config.js';
import type { ProvidersState } from './store.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function piDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-store-config-'));
  roots.push(dir);
  return dir;
}

describe('writeStorePiConfig', () => {
  it('carries declared input modalities into the generated models.json', () => {
    const dir = piDir();
    const providers: ProvidersState = {
      'ollama-cloud': {
        api: 'openai-completions',
        baseUrl: 'https://ollama.com/v1',
        envName: 'MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY',
        apiKeyRef: 'file:providers/ollama-cloud/api-key',
        models: [
          { id: 'qwen3.5:397b-cloud', input: ['text', 'image'] },
          { id: 'glm-5.2:cloud' },
        ],
      },
    };

    writeStorePiConfig(dir, providers);

    const models = JSON.parse(
      readFileSync(join(dir, 'models.json'), 'utf8'),
    ) as { providers: Record<string, unknown> };
    expect(models.providers['ollama-cloud']).toEqual({
      api: 'openai-completions',
      apiKey: '$MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY',
      baseUrl: 'https://ollama.com/v1',
      models: [
        // Pi reads `input` to decide whether image content parts may be sent.
        { id: 'qwen3.5:397b-cloud', input: ['text', 'image'] },
        { id: 'glm-5.2:cloud' },
      ],
    });
  });
});
