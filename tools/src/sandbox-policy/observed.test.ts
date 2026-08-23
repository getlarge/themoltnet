import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SandboxProbeRun } from './types.js';

const fixtureRoot = path.resolve(
  process.cwd(),
  'test-fixtures/sandbox-policy/observed',
);

async function loadFixture(relativePath: string): Promise<SandboxProbeRun> {
  return JSON.parse(
    await readFile(path.join(fixtureRoot, relativePath), 'utf8'),
  ) as SandboxProbeRun;
}

describe('retained sandbox parity evidence', () => {
  it('replays the same catalog with no failed-open controls', async () => {
    const [docker, gondolin] = await Promise.all([
      loadFixture('docker-sandbox/v0.39.0-darwin-arm64.json'),
      loadFixture('gondolin/0.12.0-workspace-darwin-arm64.json'),
    ]);

    expect(docker.controls.map(({ scenarioId }) => scenarioId)).toEqual(
      gondolin.controls.map(({ scenarioId }) => scenarioId),
    );
    expect(docker.controls).toHaveLength(31);
    expect(docker.cleanupComplete).toBe(true);
    expect(gondolin.cleanupComplete).toBe(true);
    expect(
      docker.controls.find(
        ({ scenarioId }) => scenarioId === 'credential.adjacent-origin',
      )?.oracle?.observed,
    ).toBe(0);
    expect(
      gondolin.controls.find(
        ({ scenarioId }) => scenarioId === 'credential.adjacent-origin',
      )?.oracle?.observed,
    ).toBe(0);
    expect(
      docker.controls.filter(({ state }) => state === 'failed-open').length,
    ).toBe(0);
    expect(
      gondolin.controls.filter(({ state }) => state === 'failed-open').length,
    ).toBe(0);
    expect(
      docker.controls.filter(({ state }) => state === 'unsupported').length,
    ).toBe(2);
    expect(
      gondolin.controls.filter(({ state }) => state === 'unsupported').length,
    ).toBe(2);
  });
});
