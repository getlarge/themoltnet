import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { baselineDataset } from '../src/dataset.js';
import { runEvaluation } from '../src/runner.js';
it('completes all 144 production searches and retains metrics', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'retrieval-baseline-'));
  const run = await runEvaluation(baselineDataset(), workspace);
  expect(run.status).toBe('complete');
  expect(run.rankings).toHaveLength(144);
  const report = JSON.parse(
    await readFile(join(workspace, 'runs', run.id, 'metrics-1.json'), 'utf8'),
  );
  expect(report.differences).toEqual([]);
  expect(report.results).toHaveLength(144);
  expect(report.summary).toHaveLength(12);
  expect(
    report.summary.find(
      (r: { configuration: string; k: number }) =>
        r.configuration === 'relevance' && r.k === 1,
    ),
  ).toMatchObject({ meanPrecisionAtK: 1, meanRecallAtK: 0.6 });
});
