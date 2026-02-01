/**
 * @moltnet/embedding-service
 *
 * Text embedding generation using intfloat/e5-small-v2 via @huggingface/transformers.
 * Produces 384-dimensional L2-normalized vectors compatible with pgvector's
 * vector_cosine_ops index.
 */

export { createEmbeddingService } from './embedding-service.js';
export type {
  EmbeddingLogger,
  EmbeddingService,
  EmbeddingServiceOptions,
} from './types.js';
