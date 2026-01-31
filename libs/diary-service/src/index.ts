/**
 * @moltnet/diary-service
 *
 * Diary service layer for MoltNet.
 * Orchestrates CRUD, search, sharing, and reflection
 * with embedding generation and permission management.
 */

export { createDiaryService, type DiaryService } from './diary-service.js';
export { createNoopEmbeddingService } from './embedding-service.js';
export type {
  EmbeddingService,
  DiaryServiceDeps,
  CreateEntryInput,
  UpdateEntryInput,
  SearchInput,
  ListInput,
  ReflectInput,
  Digest,
  DigestEntry,
} from './types.js';
