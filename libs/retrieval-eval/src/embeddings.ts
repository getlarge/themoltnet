import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildEmbeddingText } from '@moltnet/diary-service';
import { createEmbeddingService } from '@moltnet/embedding-service';

import { environment, modelIdentity } from './config.js';
import type { Dataset } from './dataset.js';
import { hash } from './hash.js';
import { readJson, saveJson } from './storage.js';
export async function prepareEmbeddings(dataset: Dataset, workspace: string) {
  const cacheDir = environment.modelCache;
  if (!cacheDir)
    throw new Error('Set RETRIEVAL_MODEL_CACHE to a local E5 model directory');
  const modelFiles = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx',
  ];
  const modelHashes = await Promise.all(
    modelFiles.map(async (file) => [
      file,
      hash(await readFile(join(cacheDir, modelIdentity.modelId, file))),
    ]),
  );
  const preparationHash = hash([
    buildEmbeddingText.toString(),
    await readFile(new URL('./embeddings.ts', import.meta.url), 'utf8'),
  ]);
  const model = createEmbeddingService({
    ...modelIdentity,
    allowRemoteModels: false,
    cacheDir,
  });
  async function embed(text: string, kind: 'passage' | 'query') {
    const key = hash({
      text,
      kind,
      preparationHash,
      modelHashes,
      modelIdentity,
    });
    const path = join(workspace, 'embeddings', `${key}.json`);
    let vector: number[];
    try {
      vector = await readJson<number[]>(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      vector =
        kind === 'passage'
          ? await model.embedPassage(text)
          : await model.embedQuery(text);
      await saveJson(path, vector);
    }
    assert.equal(vector.length, 384);
    assert(vector.every(Number.isFinite));
    assert(Math.abs(Math.hypot(...vector) - 1) < 1e-5);
    return vector;
  }
  const entryVectors: number[][] = [],
    queryVectors: number[][] = [];
  for (const e of dataset.entries)
    entryVectors.push(
      await embed(buildEmbeddingText(e.content, e.tags, e.title), 'passage'),
    );
  for (const q of dataset.queries)
    queryVectors.push(await embed(q.text, 'query'));
  return {
    entryVectors,
    queryVectors,
    modelHashes,
    preparationHash,
    vectorHash: hash({ entryVectors, queryVectors }),
    modelIdentity,
  };
}
