import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadScenarioCatalog } from './catalog.js';
import { validateProbeRun } from './evidence.js';
import { sanitizeText } from './sanitize.js';
import type { SandboxProbeRun } from './types.js';

const fixtureRoot = path.resolve(
  process.cwd(),
  'test-fixtures/sandbox-policy/observed',
);
const retainedFixtures = [
  'docker-sandbox/v0.39.0-darwin-arm64.json',
  'gondolin/0.12.0-darwin-arm64.json',
] as const;

async function loadFixture(relativePath: string): Promise<{
  raw: string;
  run: SandboxProbeRun;
}> {
  const raw = await readFile(path.join(fixtureRoot, relativePath), 'utf8');
  return { raw, run: JSON.parse(raw) as SandboxProbeRun };
}

describe('retained sandbox research evidence', () => {
  it.each(retainedFixtures)(
    '%s remains structurally valid, complete, and value-free',
    async (relativePath) => {
      const catalog = await loadScenarioCatalog();
      const { raw, run } = await loadFixture(relativePath);

      expect(validateProbeRun(run)).toEqual([]);
      expect(run.catalogVersion).toBe(catalog.catalogVersion);
      expect(run.controls.map(({ scenarioId }) => scenarioId)).toEqual(
        catalog.scenarios.map(({ id }) => id),
      );
      expect(run.cleanupComplete).toBe(true);
      expect(run.cleanup.every(({ cleanup }) => cleanup === 'cleaned')).toBe(
        true,
      );
      expect(run.violations).toEqual([]);
      const evidenceLeak = run.controls.find(
        ({ scenarioId }) => scenarioId === 'credential.evidence-leak',
      );
      expect(evidenceLeak).toMatchObject({
        state: 'enforced',
        basis: 'harness-observed',
        oracle: {
          observed: { leakHits: 0 },
          passed: true,
        },
      });
      expect(
        (
          evidenceLeak?.oracle?.observed as {
            registeredSensitiveValues: number;
          }
        ).registeredSensitiveValues,
      ).toBeGreaterThan(0);
      expect(() => sanitizeText(raw)).not.toThrow();
      expect(raw).not.toMatch(/moltnet-synthetic-probe-/);
      expect(raw).not.toContain('.tmp-');
    },
  );

  it('uses the same catalog and signed source revision without normalizing outcomes', async () => {
    const [docker, gondolin] = await Promise.all(
      retainedFixtures.map((fixture) => loadFixture(fixture)),
    );

    expect(docker.run.sourceRevision).toBe(gondolin.run.sourceRevision);
    expect(docker.run.catalogVersion).toBe(gondolin.run.catalogVersion);
    expect(docker.run.controls.map(({ scenarioId }) => scenarioId)).toEqual(
      gondolin.run.controls.map(({ scenarioId }) => scenarioId),
    );
    expect(docker.run.backend).not.toEqual(gondolin.run.backend);
  });
});
