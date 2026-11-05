/**
 * Runs embedding inference on a worker thread.
 *
 * ONNX feature extraction is CPU-bound and runs synchronously on the calling
 * thread for the whole inference, so in-process use stalls every other
 * request handled by the same event loop. The worker keeps that work off the
 * main thread; the OS time-slices the CPU, so the main thread keeps serving
 * I/O even on a single vCPU.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { EmbeddingLogger } from './types.js';

export interface EmbeddingWorkerConfig {
  /** @internal Test seam replacing `@huggingface/transformers`. */
  modulePath?: string;
  modelId: string;
  quantization: 'q8' | 'q4' | 'fp32' | 'fp16';
  localModelPath?: string;
  allowRemoteModels: boolean;
}

export interface WorkerRequest {
  id: number;
  text: string;
}

export type WorkerMessage =
  | { type: 'loaded' }
  | {
      type: 'result';
      id: number;
      vector?: number[];
      error?: { message: string; stack?: string };
    };

// Source runs (this module is a `.ts` file) load the worker's `.ts` file
// directly. Bundles must emit the worker entry as `embedding-worker-thread.js`
// next to the file that inlines this module, and declare it as a build output.
function resolveWorkerEntry(): URL {
  if (import.meta.url.endsWith('.ts')) {
    return new URL('./embedding-worker-thread.ts', import.meta.url);
  }
  const built = new URL('./embedding-worker-thread.js', import.meta.url);
  if (!existsSync(built)) {
    throw new Error(
      `Embedding worker entry not found: ${fileURLToPath(built)}. ` +
        'Build @moltnet/embedding-service/worker-thread as an entry next to ' +
        'the bundle and include it in the build outputs.',
    );
  }
  return built;
}

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
    const started = new Worker(resolveWorkerEntry(), { workerData: config });
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
      try {
        worker ??= start();
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
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
