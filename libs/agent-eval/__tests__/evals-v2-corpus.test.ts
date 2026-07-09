import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readScenario } from '../src/read-scenario.js';

/**
 * Guards the committed `evals-v2/` corpus: every scenario directory must parse
 * cleanly (files present, schemas valid, rubric weights sum to 1). This makes a
 * malformed scenario a failed unit test rather than a mid-run surprise on the
 * live stack.
 */
const CORPUS_ROOT = join(import.meta.dirname, '..', '..', '..', 'evals-v2');

function scenarioDirs(): string[] {
  return readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(CORPUS_ROOT, entry.name));
}

describe('evals-v2 corpus', () => {
  const dirs = scenarioDirs();

  it('is non-empty', () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it.each(dirs)('parses %s', (dir) => {
    // Act
    const scenario = readScenario(dir);

    // Assert — the reader already enforces schema + weight validity; assert a
    // few invariants explicitly for a clear failure message.
    expect(scenario.prompt.length).toBeGreaterThan(0);
    const weightSum = scenario.rubric.criteria.reduce(
      (sum, c) => sum + c.weight,
      0,
    );
    expect(weightSum).toBeCloseTo(1, 5);
    // A gate scenario should assert at least one gate.
    expect(Object.keys(scenario.gates).length).toBeGreaterThan(0);
  });
});
