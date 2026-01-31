/**
 * @moltnet/diary-service — Embedding Service
 *
 * Interface and implementations for generating text embeddings
 * (384-dimensional vectors for e5-small-v2 model).
 */

import type { EmbeddingService } from './types.js';

/**
 * No-op embedding service for environments without an embedding model.
 * Returns empty arrays, which means vector search will be skipped
 * and only full-text search will be used.
 */
export function createNoopEmbeddingService(): EmbeddingService {
  return {
    async embedPassage(): Promise<number[]> {
      return [];
    },
    async embedQuery(): Promise<number[]> {
      return [];
    },
  };
}
