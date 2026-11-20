import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { baselineDataset, validateDataset } from '../src/dataset.js';
import { runEvaluation } from '../src/runner.js';

it.each([0, 1, Number.MAX_SAFE_INTEGER])(
  'accepts label revision %s',
  (labelRevision) => {
    expect(() =>
      validateDataset({ ...baselineDataset(), labelRevision }),
    ).not.toThrow();
  },
);

it.each([
  undefined,
  null,
  '1',
  '../outside',
  -1,
  0.5,
  Number.MAX_SAFE_INTEGER + 1,
  NaN,
  Infinity,
])(
  'rejects invalid imported label revision %s before preparing a run',
  async (value) => {
    const dataset = JSON.parse(JSON.stringify(baselineDataset()));
    dataset.labelRevision = value;
    const workspace = await mkdtemp(join(tmpdir(), 'retrieval-revision-'));
    try {
      await expect(runEvaluation(dataset, workspace)).rejects.toThrow(
        'Invalid label revision',
      );
      expect(await readdir(workspace)).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
);
