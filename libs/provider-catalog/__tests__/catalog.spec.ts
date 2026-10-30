import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  getUnsupportedRequestOptions,
  globalRuntimeModelCatalog,
  ollamaClassifierModels,
  ollamaCloudModels,
  ollamaModels,
  piRuntimeModels,
  requestOptionCapabilities,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

describe('provider catalog', () => {
  it('preserves the supported static generation providers', () => {
    expect(piRuntimeModels.length).toBeGreaterThan(0);
    const generationModels = piRuntimeModels.filter(
      (entry) => entry.capabilities.generation !== false,
    );
    expect(new Set(generationModels.map((entry) => entry.provider))).toEqual(
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

  it('offers pinned Pi classifiers separately from generation models', () => {
    const classifiers = piRuntimeModels.filter(
      (entry) => entry.capabilities.classification === true,
    );
    expect(new Set(classifiers.map((entry) => entry.provider))).toEqual(
      new Set([
        'cloudflare-workers-ai',
        'openai',
        'opencode',
        'openrouter',
        'typesafe',
        'vercel-ai-gateway',
      ]),
    );
    expect(
      classifiers.find(
        (entry) =>
          entry.provider === 'typesafe' && entry.model === 'jev-latest',
      )?.capabilities,
    ).toMatchObject({ api: 'typesafe-system-one', contextWindow: 64000 });
    expect(
      classifiers.find(
        (entry) =>
          entry.provider === 'cloudflare-workers-ai' &&
          entry.model === 'typesafe/jev',
      )?.capabilities,
    ).toMatchObject({ api: 'cloudflare-workers-ai-system-one' });
    for (const entry of classifiers) {
      expect(entry.capabilities.generation).toBe(false);
      expect(requestOptionCapabilities(entry.provider, entry.model)).toEqual({
        temperature: false,
        topP: false,
        topK: false,
        maxOutputTokens: false,
      });
    }
    expect(
      [...ollamaModels, ...ollamaCloudModels].some(
        (entry) => entry.capabilities.classification === true,
      ),
    ).toBe(false);
  });

  it('offers local Ollama decision models with version and vision requirements', () => {
    expect(ollamaClassifierModels.map((entry) => entry.model)).toEqual([
      'nimble',
      'tev1',
      'clef',
      'clef-flash',
    ]);
    for (const entry of ollamaClassifierModels) {
      const vision = entry.model.startsWith('clef');
      expect(entry.provider).toBe('ollama');
      expect(entry.capabilities).toMatchObject({
        generation: false,
        classification: true,
        api: 'typesafe-system-one',
        minimumOllamaVersion: vision ? '0.35.1' : '0.35.0',
        supportsVision: vision,
      });
      expect(entry.capabilities).not.toHaveProperty('contextWindow');
      expect(globalRuntimeModelCatalog).toContainEqual(entry);
      expect(requestOptionCapabilities(entry.provider, entry.model)).toEqual({
        temperature: false,
        topP: false,
        topK: false,
        maxOutputTokens: false,
      });
    }
    expect(
      ollamaCloudModels.some(
        (entry) => entry.capabilities.classification === true,
      ),
    ).toBe(false);
    expect(
      ollamaModels.some((entry) => entry.capabilities.classification === true),
    ).toBe(false);
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

  it('uses Ollama Cloud API model ids, not local-proxy :cloud aliases', () => {
    // `:cloud` / `-cloud` names only exist on a local Ollama server proxying
    // cloud models; the ollama-cloud provider talks to https://ollama.com/v1.
    const proxyAliases = ollamaCloudModels
      .map((entry) => entry.model)
      .filter((model) => /(:|-)cloud$/.test(model));

    expect(proxyAliases).toEqual([]);
  });

  it('records generated Ollama Cloud model capabilities', () => {
    for (const entry of ollamaCloudModels) {
      const { capabilities } = entry;
      expect(capabilities.supportsVision).toEqual(expect.any(Boolean));
      expect(capabilities.supportsReasoning).toEqual(expect.any(Boolean));
      expect(capabilities.supportsTools).toEqual(expect.any(Boolean));
      expect(capabilities.contextWindow).toEqual(expect.any(Number));
      if (capabilities.supportsReasoning) {
        expect(capabilities.thinkingLevels).toMatch(/^[a-z]+(,[a-z]+)*$/);
        expect(String(capabilities.thinkingLevels).split(',')).toContain(
          capabilities.defaultThinkingLevel,
        );
      } else {
        expect(capabilities.thinkingLevels).toBeUndefined();
      }
    }
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
        cwd: new URL('../', import.meta.url),
      }),
    ).resolves.toBeDefined();
  });
});
