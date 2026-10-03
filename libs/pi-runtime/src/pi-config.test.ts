import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { writePiConfig } from './pi-config.js';

it('declares strict tool support for an opted-in single-provider model', () => {
  const piDir = mkdtempSync(join(tmpdir(), 'pi-strict-config-'));
  try {
    writePiConfig({
      piDir,
      provider: 'ollama-cloud',
      model: 'glm-5.2:cloud',
      supportsStrictMode: true,
    });

    const config = JSON.parse(readFileSync(join(piDir, 'models.json'), 'utf8'));
    expect(config.providers['ollama-cloud'].models[0].compat).toEqual({
      supportsStrictMode: true,
    });
  } finally {
    rmSync(piDir, { recursive: true, force: true });
  }
});
