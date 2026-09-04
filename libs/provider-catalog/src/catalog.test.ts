import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  globalRuntimeModelCatalog,
  ollamaCloudModels,
  ollamaModels,
  piRuntimeModels,
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

  it('matches the installed, version-pinned Pi static catalog', async () => {
    await expect(
      execFileAsync('pnpm', ['run', 'check:pi'], {
        cwd: new URL('..', import.meta.url),
      }),
    ).resolves.toBeDefined();
  });
});
