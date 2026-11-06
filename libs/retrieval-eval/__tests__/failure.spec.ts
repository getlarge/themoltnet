import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { baselineDataset } from '../src/dataset.js';
import { type Run, runEvaluation } from '../src/runner.js';
import { readJson } from '../src/storage.js';
vi.mock('../src/embeddings.js', () => ({
  prepareEmbeddings: async () => ({
    entryVectors: [],
    queryVectors: [],
    modelIdentity: {},
    modelHashes: [],
    preparationHash: 'test',
    vectorHash: 'test',
  }),
}));
vi.mock('../src/database.js', () => ({
  executeTrials: async (
    _d: unknown,
    _v: unknown,
    _k: unknown,
    _r: unknown,
    onTrial: (r: unknown) => Promise<void>,
  ) => {
    await onTrial({
      repeat: 1,
      configuration: 'relevance',
      queryId: 'protocols',
      k: 1,
      retrievedIds: ['key-exchange'],
    });
    throw new Error('Injected database failure');
  },
}));
it('retains frozen input and completed rankings when a later trial fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'retrieval-failure-'));
  await expect(runEvaluation(baselineDataset(), root)).rejects.toThrow(
    'Injected database failure',
  );
  const [id] = await readdir(join(root, 'runs'));
  const saved = await readJson<Run>(join(root, 'runs', id, 'run.json'));
  expect(saved.status).toBe('failed');
  expect(saved.rankings).toHaveLength(1);
  expect(saved.dataset.judgments).toHaveLength(72);
});
