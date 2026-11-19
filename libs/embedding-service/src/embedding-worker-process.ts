/**
 * Pool worker entry: loads the embedding model and serves inference
 * requests posted by `createWorkerEmbedder`.
 *
 * Source runs (tests, `tsx` dev) load this file directly, because Node strips
 * the types. Application bundles build it as a separate entry next to their
 * main entry (see `apps/rest-api/vite.config.ts`). Keep it self-contained:
 * only type imports from this library, so bundling it pulls in no shared
 * chunk.
 */

import { pathToFileURL } from 'node:url';

import type * as Transformers from '@huggingface/transformers';
import workerpool from 'workerpool';

import type { EmbeddingWorkerConfig } from './embedding-worker.js';

interface Extractor {
  dispose?(): Promise<unknown>;
  (
    texts: string[],
    options: { pooling: 'mean'; normalize: boolean },
  ): Promise<{ tolist(): number[][] }>;
}

function importTransformers(
  config: EmbeddingWorkerConfig,
): Promise<typeof Transformers> {
  return config.modulePath
    ? (import(pathToFileURL(config.modulePath).href) as Promise<
        typeof Transformers
      >)
    : import('@huggingface/transformers');
}

async function loadExtractor(
  config: EmbeddingWorkerConfig,
): Promise<Extractor> {
  const { env, pipeline } = await importTransformers(config);
  env.allowLocalModels = true;
  env.allowRemoteModels = config.allowRemoteModels;
  if (config.localModelPath) env.localModelPath = config.localModelPath;
  const extractor = await pipeline('feature-extraction', config.modelId, {
    dtype: config.quantization,
    // Each pool member owns one ONNX session. Avoid multiplying native
    // thread pools when increasing the number of inference workers.
    session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
    ...(config.allowRemoteModels ? {} : { local_files_only: true }),
  });
  return extractor as unknown as Extractor;
}

// A failed load is retried by the next request.
let extractorPromise: Promise<Extractor> | undefined;
function getExtractor(config: EmbeddingWorkerConfig): Promise<Extractor> {
  extractorPromise ??= loadExtractor(config).catch((error: unknown) => {
    extractorPromise = undefined;
    throw error;
  });
  return extractorPromise;
}

// workerpool owns dispatch, queue bounds, crashes, and worker replacement.
async function embed(
  text: string,
  config: EmbeddingWorkerConfig,
): Promise<number[]> {
  const extractor = await getExtractor(config);
  const output = await extractor([text], { pooling: 'mean', normalize: false });
  return Array.from(output.tolist()[0]);
}

workerpool.worker(
  { embed },
  {
    async onTerminate() {
      const extractor = await extractorPromise;
      await extractor?.dispose?.();
    },
  },
);
