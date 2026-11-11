import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, expect, it } from 'vitest';

import {
  embeddingSources,
  evaluationSources,
  fingerprintSources,
} from '../src/fingerprint.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'retrieval-fingerprint-'));
  for (const path of [
    'libs/diary-service/src/diary-service.ts',
    'libs/embedding-service/src/embedding-service.ts',
    'libs/embedding-service/src/workers/inference.ts',
    'libs/database/src/repositories/diary-entry.repository.ts',
    'libs/retrieval-eval/src/embeddings.ts',
    'libs/retrieval-eval/src/fingerprint.ts',
    'libs/retrieval-eval/src/fixtures/baseline.ts',
    'pnpm-lock.yaml',
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), 'original');
  }
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('records dirty production search and nested fixture changes', async () => {
  const url = pathToFileURL(`${root}/`);
  const original = await fingerprintSources(evaluationSources, url);
  await writeFile(
    join(root, 'libs/database/src/repositories/diary-entry.repository.ts'),
    'changed ranking',
  );
  const changedSearch = await fingerprintSources(evaluationSources, url);
  expect(changedSearch).not.toBe(original);
  await writeFile(
    join(root, 'libs/retrieval-eval/src/fixtures/baseline.ts'),
    'changed fixture',
  );
  expect(await fingerprintSources(evaluationSources, url)).not.toBe(
    changedSearch,
  );
});

it('invalidates embedding identity on inference source or dependency changes', async () => {
  const url = pathToFileURL(`${root}/`);
  const original = await fingerprintSources(embeddingSources, url);
  await writeFile(
    join(root, 'libs/embedding-service/src/workers/inference.ts'),
    'changed pooling',
  );
  const changedInference = await fingerprintSources(embeddingSources, url);
  expect(changedInference).not.toBe(original);
  await writeFile(join(root, 'pnpm-lock.yaml'), 'changed inference dependency');
  expect(await fingerprintSources(embeddingSources, url)).not.toBe(
    changedInference,
  );
});

it('invalidates embedding identity when production text preparation changes', async () => {
  const url = pathToFileURL(`${root}/`);
  const original = await fingerprintSources(embeddingSources, url);
  await writeFile(
    join(root, 'libs/diary-service/src/diary-service.ts'),
    'changed buildEmbeddingText',
  );
  expect(await fingerprintSources(embeddingSources, url)).not.toBe(original);
});

it('is stable across input enumeration order and reports missing sources', async () => {
  const url = pathToFileURL(`${root}/`);
  expect(await fingerprintSources([...evaluationSources].reverse(), url)).toBe(
    await fingerprintSources(evaluationSources, url),
  );
  await expect(fingerprintSources(['missing.ts'], url)).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
