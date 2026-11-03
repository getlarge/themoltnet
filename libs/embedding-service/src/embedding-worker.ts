/**
 * Runs embedding inference on a worker thread.
 *
 * ONNX feature extraction is CPU-bound and runs synchronously on the calling
 * thread for the whole inference, so in-process use stalls every other
 * request handled by the same event loop. The worker keeps that work off the
 * main thread; the OS time-slices the CPU, so the main thread keeps serving
 * I/O even on a single vCPU.
 *
 * The worker is an `eval` worker so it survives bundling: this library is
 * inlined into application bundles, while `@huggingface/transformers` stays an
 * external dependency whose path is resolved at runtime and passed in.
 */

import { Worker } from 'node:worker_threads';

import type { EmbeddingLogger } from './types.js';

export interface EmbeddingWorkerConfig {
  modulePath: string;
  modelId: string;
  quantization: string;
  localModelPath?: string;
  allowRemoteModels: boolean;
}

interface WorkerResult {
  type: 'result';
  id: number;
  vector?: number[];
  error?: { message: string; stack?: string };
}

interface WorkerLoaded {
  type: 'loaded';
}

type WorkerMessage = WorkerResult | WorkerLoaded;

// CommonJS: eval workers run as scripts. Requests are processed one at a time
// because inference saturates the CPU anyway. A failed model load is retried
// by the next request, matching the in-process behaviour.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const cfg = workerData;
let extractorPromise;
function load() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const mod = await import(pathToFileURL(cfg.modulePath).href);
      const lib = typeof mod.pipeline === 'function' ? mod : mod.default;
      lib.env.allowLocalModels = true;
      lib.env.allowRemoteModels = cfg.allowRemoteModels;
      if (cfg.localModelPath) lib.env.localModelPath = cfg.localModelPath;
      const extractor = await lib.pipeline('feature-extraction', cfg.modelId, {
        dtype: cfg.quantization,
        ...(cfg.allowRemoteModels ? {} : { local_files_only: true }),
      });
      parentPort.postMessage({ type: 'loaded' });
      return extractor;
    })();
    extractorPromise.catch(() => { extractorPromise = undefined; });
  }
  return extractorPromise;
}
let queue = Promise.resolve();
parentPort.on('message', (msg) => {
  queue = queue.then(async () => {
    try {
      const extractor = await load();
      const output = await extractor([msg.text], { pooling: 'mean', normalize: false });
      parentPort.postMessage({ type: 'result', id: msg.id, vector: Array.from(output.tolist()[0]) });
    } catch (err) {
      parentPort.postMessage({
        type: 'result',
        id: msg.id,
        error: { message: err && err.message ? err.message : String(err), stack: err && err.stack },
      });
    }
  });
});
`;

export interface WorkerEmbedder {
  embedRaw(text: string): Promise<number[]>;
  close(): Promise<void>;
}

export function createWorkerEmbedder(
  config: EmbeddingWorkerConfig,
  logger: EmbeddingLogger,
): WorkerEmbedder {
  let worker: Worker | null = null;
  let closed = false;
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (vector: number[]) => void; reject: (error: Error) => void }
  >();

  function failAll(error: Error): void {
    const waiters = [...pending.values()];
    pending.clear();
    for (const waiter of waiters) waiter.reject(error);
  }

  function start(): Worker {
    logger.info(
      { modelId: config.modelId, quantization: config.quantization },
      'Loading embedding model in worker thread',
    );
    const started = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: config,
    });
    started.unref();
    started.on('message', (message: WorkerMessage) => {
      if (message.type === 'loaded') {
        logger.info({ modelId: config.modelId }, 'Embedding model loaded');
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (pending.size === 0) started.unref();
      if (message.error) {
        const error = new Error(message.error.message);
        if (message.error.stack) error.stack = message.error.stack;
        waiter.reject(error);
      } else {
        waiter.resolve(message.vector ?? []);
      }
    });
    started.on('error', (error) => {
      if (worker === started) worker = null;
      logger.error({ err: error }, 'Embedding worker failed');
      failAll(
        new Error(`Embedding worker failed: ${error.message}`, {
          cause: error,
        }),
      );
    });
    started.on('exit', (code) => {
      if (worker === started) worker = null;
      if (pending.size > 0) {
        if (!closed)
          logger.warn({ code }, 'Embedding worker exited with pending work');
        failAll(new Error(`Embedding worker exited with code ${code}`));
      }
    });
    return started;
  }

  return {
    embedRaw(text: string): Promise<number[]> {
      if (closed) {
        return Promise.reject(new Error('Embedding service closed'));
      }
      worker ??= start();
      const active = worker;
      const id = nextId++;
      return new Promise<number[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        active.ref();
        active.postMessage({ id, text });
      });
    },
    async close(): Promise<void> {
      closed = true;
      failAll(new Error('Embedding service closed'));
      const active = worker;
      worker = null;
      await active?.terminate();
    },
  };
}
