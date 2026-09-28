import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Model, normalizeContext } from '@earendil-works/pi-ai';
import {
  stream,
  streamSimple,
} from '@earendil-works/pi-ai/api/openai-completions';
import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveRuntimeProfileModel,
  RuntimeProfileModelResolutionError,
} from './model-selection.js';

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
            { id: 'plain' },
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
  it('sends the mapped effort for reasoning models and omits it for plain models', async () => {
    const piDir = createPiDir();
    writeCustomModels(piDir);
    const bodyFor = async (modelId: string, reasoning: 'low' | 'off') => {
      const { modelHandle } = await resolveRuntimeProfileModel(
        piDir,
        'custom-cloud',
        modelId,
      );
      let captured: Record<string, unknown> | undefined;
      const request = (reasoning === 'off' ? stream : streamSimple)(
        modelHandle as Model<'openai-completions'>,
        normalizeContext({
          messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
        }),
        {
          apiKey: 'test',
          ...(reasoning === 'low' ? { reasoning } : {}),
          fetch: async (_input, init) => {
            captured = JSON.parse(String(init?.body)) as Record<
              string,
              unknown
            >;
            return new Response(
              JSON.stringify({ error: { message: 'captured' } }),
              { status: 400, headers: { 'content-type': 'application/json' } },
            );
          },
        },
      );
      await request.result();
      return captured;
    };

    expect((await bodyFor('planner-fast', 'low'))?.reasoning_effort).toBe(
      'low',
    );
    expect((await bodyFor('planner-fast', 'off'))?.reasoning_effort).toBe(
      'none',
    );
    expect((await bodyFor('plain', 'low'))?.reasoning_effort).toBeUndefined();
  });
  it('resolves the Codex subscription model selected by Agent Server', async () => {
    const selection = await resolveRuntimeProfileModel(
      createPiDir(),
      'openai-codex',
      'gpt-6-sol',
      'status-board-demo',
    );

    expect(selection.modelHandle).toMatchObject({
      provider: 'openai-codex',
      id: 'gpt-6-sol',
    });
  });

  it('resolves a custom provider model from the active Pi directory', async () => {
    const piDir = createPiDir();
    writeCustomModels(piDir);

    const selection = await resolveRuntimeProfileModel(
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
    expect(
      selection.modelRuntime.getModel('custom-cloud', 'planner-fast'),
    ).toStrictEqual(selection.modelHandle);
  });

  it('fails closed instead of selecting the Pi settings default', async () => {
    const piDir = createPiDir();
    writeCustomModels(piDir);
    writeFileSync(
      join(piDir, 'settings.json'),
      JSON.stringify({
        defaultProvider: 'custom-cloud',
        defaultModel: 'planner-fast',
      }),
    );

    await expect(
      resolveRuntimeProfileModel(
        piDir,
        'custom-cloud',
        'missing-profile-model',
        'planner-profile',
      ),
    ).rejects.toThrow(RuntimeProfileModelResolutionError);
    await expect(
      resolveRuntimeProfileModel(
        piDir,
        'custom-cloud',
        'missing-profile-model',
        'planner-profile',
      ),
    ).rejects.toThrow(
      'Runtime profile "planner-profile" model "custom-cloud/missing-profile-model" was not found',
    );
  });
});
