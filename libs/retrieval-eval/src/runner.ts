import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { weights } from './config.js';
import { executeTrials } from './database.js';
import { type Dataset, validateDataset } from './dataset.js';
import { prepareEmbeddings } from './embeddings.js';
import { hash } from './hash.js';
import { type Ranking, score } from './metrics.js';
import { saveJson } from './storage.js';
export interface Run {
  schemaVersion: 1;
  id: string;
  status: 'running' | 'complete' | 'failed';
  dataset: Dataset;
  datasetHash: string;
  startedAt: string;
  revision: string;
  dirty: boolean;
  codeHash: string;
  weights: typeof weights;
  topKs: number[];
  repeats: number;
  rankings: Ranking[];
  evidence?: unknown;
  database?: unknown;
  failure?: string;
}
// Shared by CLI and UI. Never overlap transaction trials in one process.
let pending: Promise<unknown> = Promise.resolve();
export function runEvaluation(
  dataset: Dataset,
  workspace: string,
  options: {
    topKs?: number[];
    repeats?: number;
    onProgress?: (run: Run) => void;
  } = {},
) {
  const frozen = structuredClone(dataset);
  const next = pending.then(() => run(frozen, workspace, options));
  pending = next.catch(() => undefined);
  return next;
}
async function run(
  dataset: Dataset,
  workspace: string,
  options: {
    topKs?: number[];
    repeats?: number;
    onProgress?: (run: Run) => void;
  },
) {
  validateDataset(dataset);
  const topKs = options.topKs ?? [1, 3, 5],
    repeats = options.repeats ?? 2;
  if (
    !topKs.length ||
    topKs.some((k) => !Number.isSafeInteger(k) || k < 1) ||
    !Number.isSafeInteger(repeats) ||
    repeats < 1
  )
    throw new Error('Invalid trial matrix');
  const cwd = new URL('../../../', import.meta.url);
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const sourceFiles = (await readdir(new URL('./', import.meta.url)))
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const codeHash = hash(
    await Promise.all(
      sourceFiles.map(async (f) => [
        f,
        await readFile(new URL(f, import.meta.url), 'utf8'),
      ]),
    ),
  );
  const run: Run = {
    schemaVersion: 1,
    id: randomUUID(),
    status: 'running',
    dataset,
    datasetHash: hash(dataset),
    startedAt: new Date().toISOString(),
    revision: git(['rev-parse', 'HEAD']),
    dirty: !!git(['status', '--porcelain']),
    codeHash,
    weights,
    topKs,
    repeats,
    rankings: [],
  };
  const dir = join(workspace, 'runs', run.id);
  const checkpoint = async () => {
    await saveJson(join(dir, 'run.json'), run);
    options.onProgress?.(structuredClone(run));
  };
  await checkpoint();
  try {
    const vectors = await prepareEmbeddings(dataset, workspace);
    run.evidence = {
      model: vectors.modelIdentity,
      modelHashes: vectors.modelHashes,
      preparationHash: vectors.preparationHash,
      vectorHash: vectors.vectorHash,
      node: process.version,
      platform: process.platform,
    };
    await checkpoint();
    run.database = await executeTrials(
      dataset,
      vectors,
      topKs,
      repeats,
      async (ranking) => {
        run.rankings.push(ranking);
        await checkpoint();
      },
    );
    const differences = run.rankings.filter(
      (r) =>
        r.repeat > 1 &&
        JSON.stringify(r.retrievedIds) !==
          JSON.stringify(
            run.rankings.find(
              (first) =>
                first.repeat === 1 &&
                first.configuration === r.configuration &&
                first.k === r.k &&
                first.queryId === r.queryId,
            )?.retrievedIds,
          ),
    );
    await saveJson(join(dir, `metrics-${dataset.labelRevision}.json`), {
      datasetHash: run.datasetHash,
      labelRevision: dataset.labelRevision,
      differences,
      results: run.rankings.map((r) => ({ ...r, metrics: score(dataset, r) })),
    });
    if (differences.length)
      throw new Error('Repeated queries changed order or membership');
    run.status = 'complete';
    await checkpoint();
    return run;
  } catch (error) {
    run.status = 'failed';
    run.failure = error instanceof Error ? error.message : String(error);
    await checkpoint();
    throw error;
  }
}
