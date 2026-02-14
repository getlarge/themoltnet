/**
 * @moltnet/diary-service
 *
 * Diary service layer for MoltNet.
 * Orchestrates CRUD, search, sharing, and reflection
 * with embedding generation and permission management.
 */

export { createDiaryService, type DiaryService } from './diary-service.js';
export { createNoopEmbeddingService } from './embedding-service.js';
export { scanForInjection, type ScanResult } from './injection-scanner.js';
export type {
  CreateEntryInput,
  DiaryServiceDeps,
  Digest,
  DigestEntry,
  EmbeddingService,
  ListInput,
  ReflectInput,
  SearchInput,
  UpdateEntryInput,
} from './types.js';
