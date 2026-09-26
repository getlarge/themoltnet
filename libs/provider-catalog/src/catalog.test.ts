import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  getUnsupportedRequestOptions,
  globalRuntimeModelCatalog,
  ollamaCloudModels,
  ollamaModels,
  piRuntimeModels,
  requestOptionCapabilities,
} from './index.js';

const execFileAsync = promisify(execFile);

describe('provider catalog', () => {
  it('keeps the Pi-derived entries to the supported static providers', () => {
    expect(piRuntimeModels.length).toBeGreaterThan(0);
    expect(new Set(piRuntimeModels.map((entry) => entry.provider))).toEqual(
      new Set(['anthropic', 'openai-codex']),
    );
    const anthropic = piRuntimeModels.find(
      (entry) => entry.provider === 'anthropic',
    );
    expect(anthropic?.capabilities.contextWindow).toEqual(expect.any(Number));
    expect(
      piRuntimeModels.some((entry) => entry.provider === 'openai-codex'),
    ).toBe(true);
  });

  it('keeps reviewed Ollama local and Cloud suggestions separate and valid', () => {
    expect(ollamaModels).not.toHaveLength(0);
    expect(ollamaCloudModels).not.toHaveLength(0);
    expect(ollamaModels.every((entry) => entry.provider === 'ollama')).toBe(
      true,
    );
    expect(
      ollamaCloudModels.every((entry) => entry.provider === 'ollama-cloud'),
    ).toBe(true);
    expect(
      new Set(
        globalRuntimeModelCatalog.map(
          (entry) => `${entry.provider}/${entry.model}`,
        ),
      ).size,
    ).toBe(globalRuntimeModelCatalog.length);
  });

  it('records request option support and leaves unknown providers undecided', () => {
    for (const entry of piRuntimeModels) {
      for (const option of [
        'supportsMaxOutputTokens',
        'supportsTemperature',
        'supportsTopP',
        'supportsTopK',
      ]) {
        expect(entry.capabilities[option]).toEqual(expect.any(Boolean));
      }
    }
    expect(
      getUnsupportedRequestOptions('openai-codex', 'gpt-5.6-terra', {
        maxOutputTokens: 4000,
        temperature: 0.2,
      }),
    ).toEqual(['temperature', 'maxOutputTokens']);
    expect(
      getUnsupportedRequestOptions('custom', 'new-model', {
        maxOutputTokens: 4000,
      }),
    ).toEqual([]);
  });

  it('describes options for both Ollama catalogs through Pi OpenAI compatibility', () => {
    for (const entry of [...ollamaModels, ...ollamaCloudModels]) {
      expect(requestOptionCapabilities(entry.provider, entry.model)).toEqual({
        temperature: true,
        topP: true,
        topK: false,
        maxOutputTokens: true,
      });
      expect(
        getUnsupportedRequestOptions(entry.provider, entry.model, {
          temperature: 0.2,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 4000,
        }),
      ).toEqual(['topK']);
    }
  });

  it('matches the installed, version-pinned Pi static catalog', async () => {
    await expect(
      execFileAsync('pnpm', ['run', 'check:pi'], {
        cwd: new URL('..', import.meta.url),
      }),
    ).resolves.toBeDefined();
  });
});
