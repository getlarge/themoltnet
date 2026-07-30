import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveRuntimeProfileModel } from './model-selection.js';

const temporaryDirectories: string[] = [];

function createPiDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'moltnet-pi-model-selection-'));
  const piDir = join(root, 'agent');
  mkdirSync(piDir);
  temporaryDirectories.push(root);
  return piDir;
}

function writeCustomModels(piDir: string): void {
  writeFileSync(
    join(piDir, 'models.json'),
    JSON.stringify({
      providers: {
        'custom-cloud': {
          api: 'openai-completions',
          apiKey: '$CUSTOM_CLOUD_API_KEY',
          baseUrl: 'https://models.example.test/v1',
          models: [
            {
              id: 'planner-fast',
              reasoning: true,
              thinkingLevelMap: {
                off: 'none',
                low: 'low',
                medium: 'medium',
                high: 'high',
              },
            },
          ],
        },
      },
    }),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('resolveRuntimeProfileModel', () => {
  it('resolves a custom provider model from the active Pi directory', () => {
    const piDir = createPiDir();
    writeCustomModels(piDir);

    const selection = resolveRuntimeProfileModel(
      piDir,
      'custom-cloud',
      'planner-fast',
    );

    expect(selection.modelHandle).toMatchObject({
      provider: 'custom-cloud',
      id: 'planner-fast',
      api: 'openai-completions',
      baseUrl: 'https://models.example.test/v1',
    });
    expect(selection.modelRegistry.find('custom-cloud', 'planner-fast')).toBe(
      selection.modelHandle,
    );
  });

  it('fails closed instead of selecting the Pi settings default', () => {
    const piDir = createPiDir();
    writeCustomModels(piDir);
    writeFileSync(
      join(piDir, 'settings.json'),
      JSON.stringify({
        defaultProvider: 'custom-cloud',
        defaultModel: 'planner-fast',
      }),
    );

    expect(() =>
      resolveRuntimeProfileModel(
        piDir,
        'custom-cloud',
        'missing-profile-model',
      ),
    ).toThrow('refusing Pi default-model fallback');
  });
});
