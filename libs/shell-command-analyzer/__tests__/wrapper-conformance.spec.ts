import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { analyzeCommand, initAnalyzer } from '../src/index.js';

/**
 * Shared cross-language conformance fixtures. The Go `github_guard`
 * (apps/moltnet-cli) asserts the same file — both must resolve each command's
 * prefix-runner chain to the same final executable, keeping the wrapper flag
 * tables in sync without sharing parser code. See the fixture's `description`.
 */
interface ConformanceFixture {
  cases: { command: string; target: string }[];
}

const fixture = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../data/wrapper-conformance.json'),
    'utf8',
  ),
) as ConformanceFixture;

beforeAll(async () => {
  await initAnalyzer();
});

describe('wrapper conformance (shared with apps/moltnet-cli github_guard)', () => {
  it('has fixtures', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const { command, target } of fixture.cases) {
    it(`resolves ${JSON.stringify(command)} → ${target}`, async () => {
      const result = await analyzeCommand(command);
      if (!result.ok) {
        throw new Error(`expected ok for ${command}, got: ${result.reason}`);
      }
      // The final executable in a prefix-runner chain is the last resolved tool.
      const last = result.tools[result.tools.length - 1];
      expect(last.name).toBe(target);
    });
  }
});
