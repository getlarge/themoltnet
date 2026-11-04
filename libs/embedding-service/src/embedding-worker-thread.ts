/**
 * Worker thread entry: loads the embedding model and serves inference
 * requests posted by `createWorkerEmbedder`.
 *
 * Source runs (tests, `tsx` dev) load this file directly, because Node strips
 * the types. Application bundles build it as a separate entry next to their
 * main entry (see `apps/rest-api/vite.config.ts`). Keep it self-contained:
 * only type imports from this library, so bundling it pulls in no shared
 * chunk.
 */

import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

import type * as Transformers from '@huggingface/transformers';

import type {
  EmbeddingWorkerConfig,
  WorkerMessage,
  WorkerRequest,
} from './embedding-worker.js';

interface Extractor {
  (
    texts: string[],
    options: { pooling: 'mean'; normalize: boolean },
  ): Promise<{ tolist(): number[][] }>;
}

if (!parentPort) {
  throw new Error('embedding-worker-thread must run as a worker thread');
}
const port = parentPort;
const config = workerData as EmbeddingWorkerConfig;

function importTransformers(): Promise<typeof Transformers> {
  return config.modulePath
    ? (import(pathToFileURL(config.modulePath).href) as Promise<
        typeof Transformers
      >)
    : import('@huggingface/transformers');
}

async function loadExtractor(): Promise<Extractor> {
  const { env, pipeline } = await importTransformers();
  env.allowLocalModels = true;
  env.allowRemoteModels = config.allowRemoteModels;
  if (config.localModelPath) env.localModelPath = config.localModelPath;
  const extractor = await pipeline('feature-extraction', config.modelId, {
    dtype: config.quantization,
    ...(config.allowRemoteModels ? {} : { local_files_only: true }),
  });
  port.postMessage({ type: 'loaded' } satisfies WorkerMessage);
  return extractor as unknown as Extractor;
}

// A failed load is retried by the next request.
let extractorPromise: Promise<Extractor> | undefined;
function getExtractor(): Promise<Extractor> {
  extractorPromise ??= loadExtractor().catch((error: unknown) => {
    extractorPromise = undefined;
    throw error;
  });
  return extractorPromise;
}

async function handle({ id, text }: WorkerRequest): Promise<WorkerMessage> {
  try {
    const extractor = await getExtractor();
    const output = await extractor([text], {
      pooling: 'mean',
      normalize: false,
    });
    return { type: 'result', id, vector: Array.from(output.tolist()[0]) };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      type: 'result',
      id,
      error: { message: err.message, stack: err.stack },
    };
  }
}

// One request at a time: inference saturates the CPU anyway.
let queue = Promise.resolve();
port.on('message', (request: WorkerRequest) => {
  queue = queue.then(async () => port.postMessage(await handle(request)));
});
