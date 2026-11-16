/**
 * Runs embedding inference in a bounded process pool.
 *
 * ONNX feature extraction is CPU-bound and runs synchronously on the calling
 * thread for the whole inference, so in-process use stalls every other
 * request handled by the same event loop. Each process keeps that work off the
 * main thread; the OS time-slices the CPU, so the main thread keeps serving
 * I/O even on a single vCPU.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import workerpool from 'workerpool';

import type { EmbeddingLogger } from './types.js';

export interface EmbeddingWorkerConfig {
  /** @internal Test seam replacing `@huggingface/transformers`. */
  modulePath?: string;
  modelId: string;
  quantization: 'q8' | 'q4' | 'fp32' | 'fp16';
  localModelPath?: string;
  allowRemoteModels: boolean;
  workers?: number;
  maxQueue?: number;
}

// Source runs (this module is a `.ts` file) load the worker's `.ts` file
// directly. Bundles must emit the worker entry as `embedding-worker-process.js`
// next to the file that inlines this module, and declare it as a build output.
function resolveWorkerEntry(): URL {
  if (import.meta.url.endsWith('.ts')) {
    return new URL('./embedding-worker-process.ts', import.meta.url);
  }
  const built = new URL('./embedding-worker-process.js', import.meta.url);
  if (!existsSync(built)) {
    throw new Error(
      `Embedding worker entry not found: ${fileURLToPath(built)}. ` +
        'Build @moltnet/embedding-service/worker-process as an entry next to ' +
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
  let closed = false;
  const workers = config.workers ?? 1;
  const pool = workerpool.pool(fileURLToPath(resolveWorkerEntry()), {
    // Isolate native ONNX state and failures across pool members.
    workerType: 'process',
    minWorkers: workers,
    maxWorkers: workers,
    maxQueueSize: config.maxQueue ?? 64,
  });
  logger.info(
    { workers, maxQueue: pool.maxQueueSize },
    'Embedding process pool configured',
  );

  return {
    embedRaw(text: string): Promise<number[]> {
      if (closed) return Promise.reject(new Error('Embedding service closed'));
      try {
        return Promise.resolve(
          pool.exec<
            (text: string, config: EmbeddingWorkerConfig) => Promise<number[]>
          >('embed', [text, config]),
        );
      } catch (err) {
        return Promise.reject(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await pool.terminate(true);
    },
  };
}
