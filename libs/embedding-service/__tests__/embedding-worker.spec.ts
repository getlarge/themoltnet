import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createEmbeddingService } from '../src/embedding-service.js';
import { createWorkerEmbedder } from '../src/embedding-worker.js';
import type { EmbeddingService } from '../src/types.js';

const fakeTransformers = fileURLToPath(
  new URL('./fixtures/fake-transformers.mjs', import.meta.url),
);

function createWorkerService(modelId = 'fake-model'): EmbeddingService {
  return createEmbeddingService({
    modelId,
    executor: 'worker',
    transformersModulePath: fakeTransformers,
  });
}

describe('createEmbeddingService (worker executor)', () => {
  let service: EmbeddingService | undefined;

  afterEach(async () => {
    await service?.close?.();
    service = undefined;
  });

  it('keeps the main event loop responsive during CPU-bound inference', async () => {
    // Arrange
    service = createWorkerService();
    await service.embedPassage('warmup');
    let last = performance.now();
    let maxGap = 0;
    const ticker = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 5);

    // Act
    await service.embedPassage('busy:400');
    clearInterval(ticker);

    // Assert
    expect(maxGap).toBeLessThan(150);
  });

  it('prefixes passages and queries and returns L2-normalized vectors', async () => {
    // Arrange
    service = createWorkerService();

    // Act
    const passage = await service.embedPassage('hello');
    const query = await service.embedQuery('hello');

    // Assert
    expect(passage).toHaveLength(384);
    expect(passage[0]).toBe(1);
    expect(query[1]).toBe(1);
  });

  it('serves concurrent requests in order', async () => {
    // Arrange
    service = createWorkerService();

    // Act
    const results = await Promise.all([
      service.embedPassage('a'),
      service.embedQuery('b'),
      service.embedPassage('c'),
    ]);

    // Assert
    expect(results.map((vector) => vector.indexOf(1))).toEqual([0, 1, 0]);
  });

  it('rejects when inference fails and keeps serving afterwards', async () => {
    // Arrange
    service = createWorkerService();

    // Act / Assert
    await expect(service.embedPassage('throw')).rejects.toThrow(
      'inference failed',
    );
    await expect(service.embedPassage('ok')).resolves.toHaveLength(384);
  });

  it('rejects pending work when the worker dies and recovers on the next call', async () => {
    // Arrange
    service = createWorkerService();
    await service.embedPassage('warmup');

    // Act / Assert
    await expect(service.embedPassage('crash')).rejects.toThrow(
      /Workerpool Worker terminated/,
    );
    await expect(service.embedPassage('recovered')).resolves.toHaveLength(384);
  });

  it('rejects when the model fails to load, without hanging later calls', async () => {
    // Arrange
    service = createWorkerService('fail-load');

    // Act / Assert
    await expect(service.embedPassage('a')).rejects.toThrow(
      'model load failed',
    );
    await expect(service.embedPassage('b')).rejects.toThrow(
      'model load failed',
    );
  });

  it('uses two pool workers and rejects overflow at the configured bound', async () => {
    const pool = createWorkerEmbedder(
      {
        modelId: 'fake-model',
        quantization: 'q8',
        allowRemoteModels: false,
        modulePath: fakeTransformers,
        workers: 2,
        maxQueue: 1,
      },
      { info() {}, warn() {}, error() {}, debug() {} },
    );
    try {
      // Occupy both workers, leave one waiting, then exceed the queue bound.
      const first = pool.embedRaw('thread busy:300');
      const second = pool.embedRaw('thread busy:300');
      const waiting = pool.embedRaw('thread');
      await expect(pool.embedRaw('overflow')).rejects.toThrow(/queue/i);
      const vectors = await Promise.all([first, second, waiting]);
      expect(new Set(vectors.slice(0, 2).map((v) => v[0])).size).toBe(2);
      expect(vectors[2]).toHaveLength(384);
    } finally {
      await pool.close();
    }
  });

  it('rejects calls after close', async () => {
    // Arrange
    service = createWorkerService();
    await service.embedPassage('warmup');

    // Act
    await service.close?.();

    // Assert
    await expect(service.embedPassage('late')).rejects.toThrow(/closed/);
  });
});
