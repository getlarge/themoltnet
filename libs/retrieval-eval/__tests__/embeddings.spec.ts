import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { environment, modelIdentity } from '../src/config.js';
import { baselineDataset } from '../src/dataset.js';
import { prepareEmbeddings } from '../src/embeddings.js';

const model = vi.hoisted(() => ({
  passage: vi.fn(),
  query: vi.fn(),
  close: vi.fn(),
  fingerprint: 'original',
}));
vi.mock('@moltnet/embedding-service', () => ({
  createEmbeddingService: () => ({
    embedPassage: model.passage,
    embedQuery: model.query,
    close: model.close,
  }),
}));
vi.mock('../src/fingerprint.js', () => ({
  embeddingSources: [],
  fingerprintSources: async () => model.fingerprint,
}));

let workspace: string;
const previousCache = environment.modelCache;
beforeEach(async () => {
  vi.clearAllMocks();
  model.fingerprint = 'original';
  model.passage.mockResolvedValue([1, ...Array<number>(383).fill(0)]);
  model.query.mockResolvedValue([1, ...Array<number>(383).fill(0)]);
  model.close.mockResolvedValue(undefined);
  workspace = await mkdtemp(join(tmpdir(), 'retrieval-embeddings-'));
  environment.modelCache = join(workspace, 'model');
  for (const file of [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx',
  ]) {
    const path = join(environment.modelCache, modelIdentity.modelId, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'model fixture');
  }
});
afterEach(async () => {
  environment.modelCache = previousCache;
  await rm(workspace, { recursive: true, force: true });
});

it('reuses cached vectors and closes every prepared service', async () => {
  const dataset = baselineDataset();
  await prepareEmbeddings(dataset, workspace);
  const calls = model.passage.mock.calls.length + model.query.mock.calls.length;
  await prepareEmbeddings(dataset, workspace);
  expect(model.passage.mock.calls.length + model.query.mock.calls.length).toBe(
    calls,
  );
  expect(model.close).toHaveBeenCalledTimes(2);
});

it('recomputes cached vectors when preparation identity changes', async () => {
  const dataset = baselineDataset();
  const first = await prepareEmbeddings(dataset, workspace);
  const passages = model.passage.mock.calls.length;
  const queries = model.query.mock.calls.length;
  model.fingerprint = 'changed production implementation';
  const second = await prepareEmbeddings(dataset, workspace);
  expect(second.preparationHash).not.toBe(first.preparationHash);
  expect(model.passage).toHaveBeenCalledTimes(passages * 2);
  expect(model.query).toHaveBeenCalledTimes(queries * 2);
  expect(model.close).toHaveBeenCalledTimes(2);
});

it('closes the service when embedding fails and preserves the failure', async () => {
  const failure = new Error('inference failed');
  model.passage.mockRejectedValueOnce(failure);
  await expect(prepareEmbeddings(baselineDataset(), workspace)).rejects.toBe(
    failure,
  );
  expect(model.close).toHaveBeenCalledOnce();
});
